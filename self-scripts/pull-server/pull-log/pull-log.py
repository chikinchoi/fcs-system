"""Download FCS application logs over SFTP. Read-only.

Each run lists the configured directories and downloads the named logs into
the local folder for that environment. It never uploads, deletes, renames,
or changes permissions on the server.

Login is attempted once per host. A failed password stops the run immediately
and does not try again, so the account is not locked by retries.

  py -3 self-scripts/pull-server/pull-log/pull-log.py sit
  py -3 self-scripts/pull-server/pull-log/pull-log.py uat
  py -3 self-scripts/pull-server/pull-log/pull-log.py prod
  py -3 self-scripts/pull-server/pull-log/pull-log.py prod --primary 78
  py -3 self-scripts/pull-server/pull-log/pull-log.py prod --all
  py -3 self-scripts/pull-server/pull-log/pull-log.py prod --dry-run
  py -3 self-scripts/pull-server/pull-log/pull-log.py --self-test
"""

import argparse
import json
import os
import socket
import stat
import sys
import time
from datetime import datetime
from pathlib import Path

import paramiko

# FileZilla asks for large blocks. Paramiko's 32 KB reads make a 2 GB log
# take minutes, because each block waits on a round trip.
paramiko.SFTPFile.MAX_REQUEST_SIZE = 1024 * 1024

HERE = Path(__file__).resolve().parent
SERVERS_PATH = HERE.parent / "servers.local.json"
ENV_NAMES = ("sit", "uat", "prod")
ROTATED_CAP = 30
CONNECT_TIMEOUT = 20


class AuthStop(Exception):
    """Login failed. The run must end without another attempt."""

    def __init__(self, host, username):
        self.host = host
        self.username = username
        super().__init__(f"Authentication failed for {username}@{host}")


class ReadOnlySftp:
    """SFTP handle that exposes list and download only."""

    def __init__(self, sftp):
        self._sftp = sftp

    def listdir_attr(self, path):
        return self._sftp.listdir_attr(path)

    def get(self, remote_path, local_path, callback=None, size=0):
        # Paramiko's get() reads 32 KB at a time. FileZilla uses a 4 MB
        # socket buffer and large reads, which is what makes the same file
        # finish quickly.
        with self._sftp.open(remote_path, "rb") as remote:
            remote.prefetch(max_concurrent_requests=64)
            with open(local_path, "wb", buffering=4 * 1024 * 1024) as local:
                done = 0
                while True:
                    block = remote.read(1024 * 1024)
                    if not block:
                        break
                    local.write(block)
                    done += len(block)
                    if callback is not None:
                        callback(done, size)

    def close(self):
        self._sftp.close()

    def __getattr__(self, name):
        raise PermissionError(f"refusing remote {name}: this pull is read-only")


def log(message, secrets):
    text = str(message)
    for secret in secrets:
        if secret:
            text = text.replace(secret, "***")
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {text}"
    print(line, flush=True)
    return line


def shared_servers():
    if not SERVERS_PATH.is_file():
        return {}
    with SERVERS_PATH.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise SystemExit(f"{SERVERS_PATH} must be a JSON object")
    return data


def fill_login(host):
    """Use the shared server login when this host has no password of its own."""
    if "password" in host:
        return
    account = shared_servers().get(host.get("host"))
    if not isinstance(account, dict):
        host["password"] = ""
        return
    if "username" not in host:
        host["username"] = account.get("username", "")
    if "port" not in host:
        host["port"] = account.get("port", 22)
    password = account.get("password", "")
    host["password"] = password if isinstance(password, str) else ""


def load_config(path):
    if not path.is_file():
        raise SystemExit(f"Missing {path}")
    with path.open(encoding="utf-8") as handle:
        config = json.load(handle)
    if not isinstance(config, dict):
        raise SystemExit(f"{path} must be a JSON object")
    local_dir = config.get("local_dir")
    hosts = config.get("hosts")
    if not local_dir or not isinstance(hosts, list) or not hosts:
        raise SystemExit(f"{path} needs local_dir and at least one host")
    rotated_days = config.get("rotated_days", 0)
    if not isinstance(rotated_days, int) or rotated_days < 0:
        raise SystemExit("rotated_days must be a whole number, 0 or more")
    for host in hosts:
        fill_login(host)
        for key in ("host", "username", "password"):
            if not isinstance(host.get(key), str) or host.get(key) == "":
                raise SystemExit(
                    f"{path} host {host.get('host', '?')} needs a non-empty {key}. "
                    "Login was not attempted."
                )
        host["port"] = int(host.get("port", 22))
        files = host.get("files")
        if not isinstance(files, list) or not files:
            raise SystemExit(f"{host['host']} needs a files list")
        folder = host.get("dir", "")
        if folder:
            check_local_name(folder)
        for item in files:
            remote = item.get("remote", "")
            local_name = item.get("local", "")
            if not remote.startswith("/") or ".." in Path(remote).parts:
                raise SystemExit(f"remote path must be absolute: {remote}")
            check_local_name(local_name)
    primary = config.get("primary", [])
    if primary is None:
        primary = []
    if not isinstance(primary, list) or any(not isinstance(name, str) or not name for name in primary):
        raise SystemExit("primary must be a list of server folder names")
    known = {host.get("dir") for host in hosts}
    missing_primary = [name for name in primary if name not in known]
    if missing_primary:
        raise SystemExit(f"primary is not a host dir: {', '.join(missing_primary)}")
    config["primary"] = primary
    config["local_dir"] = str(Path(local_dir))
    config["rotated_days"] = rotated_days
    return config


def check_local_name(name):
    path = Path(name)
    if not name or path.is_absolute() or ".." in path.parts:
        raise SystemExit(f"local name must stay inside the output folder: {name}")


def local_path(root, name):
    check_local_name(name)
    dest = (root / name).resolve()
    root_resolved = root.resolve()
    if dest != root_resolved and root_resolved not in dest.parents:
        raise SystemExit(f"local name escapes the output folder: {name}")
    return dest


def select_entries(entries, remote_name, rotated_days, now):
    """Current file, plus rotated siblings new enough to keep."""
    current = None
    rotated = []
    cutoff = None if rotated_days == 0 else now - rotated_days * 86400
    for entry in entries:
        name = entry.filename
        if name in (".", ".."):
            continue
        mode = entry.st_mode or 0
        if not stat.S_ISREG(mode) or stat.S_ISLNK(mode):
            continue
        if name == remote_name:
            current = entry
        elif cutoff is not None and name.startswith(remote_name + "."):
            if (entry.st_mtime or 0) >= cutoff:
                rotated.append(entry)
    rotated.sort(key=lambda item: item.st_mtime or 0, reverse=True)
    dropped = max(0, len(rotated) - ROTATED_CAP)
    return current, rotated[:ROTATED_CAP], dropped


def rotated_local_name(local_name, remote_name, rotated_name):
    return local_name + rotated_name[len(remote_name):]


def open_fast_socket(host, port):
    """Same 4 MB receive buffer FileZilla uses."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 256 * 1024)
    sock.settimeout(CONNECT_TIMEOUT)
    try:
        sock.connect((host, port))
    except Exception:
        sock.close()
        raise
    sock.settimeout(None)
    return sock


def connect_once(host, attempted):
    key = (host["host"], host["port"], host["username"])
    if key in attempted:
        raise SystemExit(
            f"Refusing a second login attempt for {host['username']}@{host['host']}"
        )
    attempted.add(key)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    sock = open_fast_socket(host["host"], host["port"])
    try:
        client.connect(
            hostname=host["host"],
            port=host["port"],
            username=host["username"],
            password=host["password"],
            timeout=CONNECT_TIMEOUT,
            banner_timeout=CONNECT_TIMEOUT,
            auth_timeout=CONNECT_TIMEOUT,
            allow_agent=False,
            look_for_keys=False,
            compress=False,
            sock=sock,
        )
    except paramiko.AuthenticationException:
        client.close()
        sock.close()
        raise AuthStop(host["host"], host["username"]) from None
    except Exception:
        client.close()
        sock.close()
        raise
    return client


def tune_transport(client):
    """Widen the SSH window before the SFTP channel opens."""
    transport = client.get_transport()
    if transport is None:
        return
    transport.default_window_size = 64 * 1024 * 1024
    transport.default_max_packet_size = 1024 * 1024
    transport.packetizer.REKEY_BYTES = 1 << 40
    transport.packetizer.REKEY_PACKETS = 1 << 40


def download(sftp, remote_path, dest, size):
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(dest.name + ".partial")
    log(f"downloading {size} bytes {remote_path} -> {dest}", [])
    started = time.monotonic()
    step = 32 * 1024 * 1024
    state = {"next_bytes": step, "next_time": started + 2}

    def callback(done, total):
        now = time.monotonic()
        total = total or size
        if done < state["next_bytes"] and now < state["next_time"] and done != total:
            return
        state["next_bytes"] = done + step
        state["next_time"] = now + 2
        rate = done / max(now - started, 0.001) / (1024 * 1024)
        log(f"{done} / {total} bytes {dest.name}  {rate:.0f} MB/s", [])

    try:
        sftp.get(remote_path, str(partial), callback=callback, size=size)
        os.replace(partial, dest)
    except (Exception, KeyboardInterrupt):
        partial.unlink(missing_ok=True)
        raise
    log(f"saved {dest}", [])


def choose_hosts(config, primary_arg, take_all):
    """Primary pair unless this run asks for the other pair or every server."""
    hosts = config["hosts"]
    if take_all:
        return hosts
    if primary_arg:
        key = primary_arg.strip().lower()
        if key not in ("76", "78"):
            raise SystemExit("Use --primary 76 or --primary 78")
        chosen = [host for host in hosts if str(host.get("dir", "")).lower().startswith(key)]
        if not chosen:
            raise SystemExit(f"no host dir starts with {key}")
        return chosen
    if not config.get("primary"):
        return hosts
    wanted = set(config["primary"])
    return [host for host in hosts if host.get("dir") in wanted]


def pull(config, connect, dry_run=False, now=None):
    """Download every configured host. AuthStop means do not continue."""
    root = Path(config["local_dir"])
    now = datetime.now().timestamp() if now is None else now
    saved = []
    missing = []
    notes = []
    for host in config["hosts"]:
        try:
            client = connect(host)
        except AuthStop:
            raise
        except Exception as error:
            log(
                f"connection failed for {host['username']}@{host['host']}: "
                f"{type(error).__name__}: {error}. No retry.",
                [],
            )
            missing.append(
                f"{host['host']} connect failed ({type(error).__name__}: {error})"
            )
            continue
        try:
            tune_transport(client)
            sftp = ReadOnlySftp(client.open_sftp())
            try:
                folder = host.get("dir") or ""
                target = local_path(root, folder) if folder else root
                saved.extend(
                    pull_host(
                        sftp,
                        host,
                        target,
                        config["rotated_days"],
                        now,
                        dry_run,
                        missing,
                        notes,
                    )
                )
            finally:
                sftp.close()
        except Exception as error:
            missing.append(f"{host['host']} read failed ({type(error).__name__}: {error})")
        finally:
            client.close()
    return saved, missing, notes


def pull_host(sftp, host, root, rotated_days, now, dry_run, missing, notes):
    listings = {}
    saved = []
    for item in host["files"]:
        remote = item["remote"]
        directory, remote_name = remote.rsplit("/", 1)
        if directory not in listings:
            log(f"listing {directory}", [])
            try:
                listings[directory] = sftp.listdir_attr(directory)
            except OSError as error:
                log(f"MISSING {remote} ({error})", [])
                missing.append(f"{remote} ({error})")
                continue
        current, rotated, dropped = select_entries(
            listings[directory], remote_name, rotated_days, now
        )
        if current is None:
            log(f"MISSING {remote}", [])
            missing.append(remote)
            continue
        targets = [(remote, item["local"], current)]
        for entry in rotated:
            targets.append(
                (
                    f"{directory}/{entry.filename}",
                    rotated_local_name(item["local"], remote_name, entry.filename),
                    entry,
                )
            )
        for remote_path, local_name, entry in targets:
            dest = local_path(root, local_name)
            size = entry.st_size or 0
            if dry_run:
                log(f"would download {size} bytes {remote_path} -> {dest}", [])
                saved.append({"remote": remote_path, "local": str(dest), "bytes": size, "dry_run": True})
                continue
            if dest.is_file() and dest.stat().st_size == size:
                log(f"already saved {dest.name} ({size} bytes)", [])
                saved.append({"remote": remote_path, "local": str(dest), "bytes": size, "unchanged": True})
                continue
            try:
                download(sftp, remote_path, dest, size)
            except OSError as error:
                missing.append(f"{remote_path} ({type(error).__name__}: {error})")
                continue
            saved.append({"remote": remote_path, "local": str(dest), "bytes": size})
        if dropped:
            notes.append(
                f"{remote} downloaded the newest {ROTATED_CAP} rotated files, skipped {dropped} older names"
            )
    return saved


def write_manifest(root, saved, missing, notes):
    root.mkdir(parents=True, exist_ok=True)
    manifest = {
        "pulled_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "saved": saved,
        "missing": missing,
        "notes": notes,
    }
    (root / "_pull_manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )


def secrets_in(config):
    return [host.get("password", "") for host in config.get("hosts", [])]


def build_parser():
    parser = argparse.ArgumentParser(description="Read-only pull of FCS logs over SFTP.")
    parser.add_argument(
        "env",
        nargs="?",
        help="sit, uat, prod, or a path to an env json file",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log in once, list the files, and do not download",
    )
    parser.add_argument(
        "--primary",
        help="Production pair to pull: 76 or 78. Default is the primary list in the json.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Pull every host in the json, including the standby pair",
    )
    parser.add_argument("--self-test", action="store_true", help="Run local checks only")
    return parser


def config_path(env):
    candidate = Path(env)
    if candidate.suffix.lower() == ".json":
        return candidate if candidate.is_absolute() else HERE / candidate
    if env not in ENV_NAMES:
        raise SystemExit(f"Use one of {', '.join(ENV_NAMES)}, or a json path")
    return HERE / f"{env}.json"


def main(argv):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.self_test:
        self_test()
        print("self-test ok")
        return 0
    if not args.env:
        parser.print_help()
        return 2
    if args.all and args.primary:
        raise SystemExit("Use either --all or --primary")
    config = load_config(config_path(args.env))
    config["hosts"] = choose_hosts(config, args.primary, args.all)
    secrets = secrets_in(config)
    chosen = ", ".join(host.get("dir") or host["host"] for host in config["hosts"])
    log(f"servers {chosen}", secrets)
    attempted = set()

    def connect(host):
        log(f"connecting {host['username']}@{host['host']}:{host['port']}", secrets)
        return connect_once(host, attempted)

    try:
        saved, missing, notes = pull(config, connect, dry_run=args.dry_run)
    except AuthStop as stop:
        log(
            f"AUTHENTICATION FAILED for {stop.username}@{stop.host}. "
            "Stopped. No retry.",
            secrets,
        )
        return 2
    except KeyboardInterrupt:
        log("Stopped. Remote files were not changed. No further login.", secrets)
        return 130
    except Exception as error:
        log(f"FAILED {type(error).__name__}: {error}", secrets)
        return 1

    for item in saved:
        action = "would download" if item.get("dry_run") else "saved"
        log(f"{action} {item['bytes']} bytes {item['remote']} -> {item['local']}", secrets)
    for item in notes:
        log(f"NOTE {item}", secrets)
    for item in missing:
        log(f"MISSING {item}", secrets)
    if not args.dry_run:
        write_manifest(Path(config["local_dir"]), saved, missing, notes)
        log(f"manifest {Path(config['local_dir']) / '_pull_manifest.json'}", secrets)
    if missing or not saved:
        return 1
    return 0


def self_test():
    now = 1_700_000_000

    class Entry:
        def __init__(self, filename, mode, mtime, size=10):
            self.filename = filename
            self.st_mode = mode
            self.st_mtime = mtime
            self.st_size = size

    reg = stat.S_IFREG
    entries = [
        Entry("fcs_app.log", reg, now - 10, 100),
        Entry("fcs_app.log.2026-11-12", reg, now - 3600, 50),
        Entry("fcs_app.log.2026-10-01", reg, now - 10 * 86400, 50),
        Entry("other.log", reg, now, 5),
        Entry("subdir", stat.S_IFDIR, now, 0),
    ]
    current, rotated, dropped = select_entries(entries, "fcs_app.log", 2, now)
    assert current.filename == "fcs_app.log"
    assert [item.filename for item in rotated] == ["fcs_app.log.2026-11-12"]
    assert dropped == 0
    assert rotated_local_name("fcshapay-76a.log", "fcshapay.log", "fcshapay.log.2026-11-12") == (
        "fcshapay-76a.log.2026-11-12"
    )
    current_only, none, _ = select_entries(entries, "fcs_app.log", 0, now)
    assert current_only.filename == "fcs_app.log"
    assert none == []

    class Raw:
        def listdir_attr(self, path):
            return []

        def get(self, remote_path, local_path):
            return None

        def put(self, *args):
            raise AssertionError("raw put must not be used")

        def remove(self, *args):
            raise AssertionError("raw remove must not be used")

    guarded = ReadOnlySftp(Raw())
    guarded.listdir_attr("/appl/pbrcbar/log/fcs")
    try:
        guarded.put("/tmp/x", "/tmp/y")
        raise AssertionError("put was allowed")
    except PermissionError:
        pass
    try:
        guarded.remove("/tmp/x")
        raise AssertionError("remove was allowed")
    except PermissionError:
        pass

    calls = {"n": 0}

    def fail_auth(host):
        calls["n"] += 1
        raise AuthStop(host["host"], host["username"])

    config = {
        "local_dir": "D:/FCS/remote-log",
        "rotated_days": 0,
        "hosts": [
            {
                "host": "server-a",
                "port": 22,
                "username": "pbrcbar",
                "password": "secret-a",
                "files": [{"remote": "/appl/pbrcbar/log/fcs/fcs_app.log", "local": "fcs_app.log"}],
            },
            {
                "host": "server-b",
                "port": 22,
                "username": "pbrcbar",
                "password": "secret-b",
                "files": [{"remote": "/appl/pbrcbar/log/fcs/fcs_app.log", "local": "fcs_app.log"}],
            },
        ],
    }
    try:
        pull(config, fail_auth)
        raise AssertionError("auth failure continued")
    except AuthStop as stop:
        assert stop.host == "server-a"
    assert calls["n"] == 1

    attempted = set()

    class Boom(paramiko.AuthenticationException):
        pass

    real_client = paramiko.SSHClient

    class FakeClient:
        def __init__(self):
            self.closed = False

        def set_missing_host_key_policy(self, policy):
            return None

        def connect(self, **kwargs):
            raise Boom("Authentication failed.")

        def close(self):
            self.closed = True

    paramiko.SSHClient = FakeClient
    real_open = open_fast_socket

    class DummySocket:
        def close(self):
            return None

    globals()["open_fast_socket"] = lambda host, port: DummySocket()
    try:
        try:
            connect_once(config["hosts"][0], attempted)
            raise AssertionError("expected auth stop")
        except AuthStop:
            pass
        try:
            connect_once(config["hosts"][0], attempted)
            raise AssertionError("second attempt was allowed")
        except SystemExit as error:
            assert "second login" in str(error)
    finally:
        paramiko.SSHClient = real_client
        globals()["open_fast_socket"] = real_open

    redacted = log("password secret-a failed", ["secret-a"])
    assert "secret-a" not in redacted
    assert "***" in redacted
    blank = HERE / "_blank_password_check.json"
    blank.write_text(
        '{"local_dir":"D:/FCS/remote-log/pull-log/sit","rotated_days":0,'
        '"hosts":[{"host":"eaptst72a","username":"pbrcbar","password":"",'
        '"files":[{"remote":"/appl/pbrcbar/log/fcs/fcs_app.log","local":"fcs/fcs_app.log"}]}]}',
        encoding="utf-8",
    )
    try:
        try:
            load_config(blank)
            raise AssertionError("empty password was accepted")
        except SystemExit as error:
            assert "not attempted" in str(error)
    finally:
        blank.unlink(missing_ok=True)

    sample = {
        "primary": ["76a", "76b"],
        "hosts": [
            {"dir": "76a", "host": "eapsrv76a"},
            {"dir": "76b", "host": "eapsrv76b"},
            {"dir": "78a", "host": "eapsrv78a"},
            {"dir": "78b", "host": "eapsrv78b"},
        ],
    }
    assert [host["dir"] for host in choose_hosts(sample, None, False)] == ["76a", "76b"]
    assert [host["dir"] for host in choose_hosts(sample, "78", False)] == ["78a", "78b"]
    assert len(choose_hosts(sample, None, True)) == 4
    try:
        choose_hosts(sample, "77", False)
        raise AssertionError("bad primary was accepted")
    except SystemExit:
        pass


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
