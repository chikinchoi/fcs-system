"""Copy PNG files from the SIT WebLogic exploded WAR over SFTP.

Each run adds files into D:/FCS/backup_sit_server_receipt. A file already
there with the same name and size is left in place. A same name with a
different size is replaced by the server copy. Files the server no longer
has are kept. The run is appended to pull.log.

The host and remote path are read from sftp-png.local.json next to this file.
Login comes from servers.local.json in the pull-server folder.
The folder name m5yz7l changes when WebLogic redeploys the app. If that
exact path is gone, the script uses the newest */war under the same app.
"""

import stat
import sys
import json
from datetime import datetime
from pathlib import Path

import paramiko

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "sftp-png.local.json"
SERVERS_PATH = HERE.parent / "servers.local.json"
OUT_ROOT = Path(r"D:\FCS\backup_sit_server_receipt")
LOG_PATH = OUT_ROOT / "pull.log"
APP_PARENT = (
    "/appl/pbrcbar/temp/wls1_fcs_sit/FcsCorpSit_eaptst72a_14495"
    "/servers/FcsCorpSit_eaptst72a_14495/tmp/_WL_user"
    "/PBRC_EFCS_MAIN_APP_1.0.0"
)


def log(message):
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {message}"
    print(line, flush=True)
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def load_config():
    if not CONFIG_PATH.is_file():
        raise SystemExit(f"Missing {CONFIG_PATH}")
    with CONFIG_PATH.open(encoding="utf-8") as handle:
        config = json.load(handle)
    if config.get("password"):
        return config
    if not SERVERS_PATH.is_file():
        raise SystemExit(f"Missing {SERVERS_PATH}")
    with SERVERS_PATH.open(encoding="utf-8") as handle:
        servers = json.load(handle)
    account = servers.get(config.get("host"))
    if not isinstance(account, dict) or not account.get("password"):
        raise SystemExit(f"No shared login for {config.get('host')}")
    config["username"] = account["username"]
    config["password"] = account["password"]
    config["port"] = int(account.get("port", config.get("port", 22)))
    return config


def walk_png(sftp, remote_dir):
    for entry in sftp.listdir_attr(remote_dir):
        name = entry.filename
        if name in (".", ".."):
            continue
        remote_path = remote_dir.rstrip("/") + "/" + name
        mode = entry.st_mode or 0
        if stat.S_ISDIR(mode):
            yield from walk_png(sftp, remote_path)
        elif stat.S_ISLNK(mode):
            continue
        elif name.lower().endswith(".png"):
            yield remote_path, entry.st_size or 0


def resolve_war(sftp, preferred):
    try:
        sftp.stat(preferred)
        return preferred
    except OSError:
        pass

    newest = None
    newest_mtime = -1
    for entry in sftp.listdir_attr(APP_PARENT):
        if not stat.S_ISDIR(entry.st_mode or 0):
            continue
        candidate = f"{APP_PARENT}/{entry.filename}/war"
        try:
            info = sftp.stat(candidate)
        except OSError:
            continue
        mtime = info.st_mtime or 0
        if mtime >= newest_mtime:
            newest = candidate
            newest_mtime = mtime
    if newest is None:
        raise SystemExit(f"Remote war path not found: {preferred}")
    return newest


def name_list(names):
    if not names:
        return "-"
    if len(names) <= 30:
        return ",".join(names)
    return ",".join(names[:30]) + f",...+{len(names) - 30}"


def main():
    config = load_config()
    OUT_ROOT.mkdir(parents=True, exist_ok=True)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=config["host"],
            port=int(config.get("port", 22)),
            username=config["username"],
            password=config["password"],
            timeout=60,
            banner_timeout=60,
            auth_timeout=60,
            allow_agent=False,
            look_for_keys=False,
        )
        sftp = client.open_sftp()
        try:
            remote_dir = resolve_war(sftp, config["remote_dir"].rstrip("/"))
            files = list(walk_png(sftp, remote_dir))
            added = []
            updated = []
            skipped = 0
            for remote_path, size in files:
                name = remote_path.rsplit("/", 1)[-1]
                local_path = OUT_ROOT / name
                if local_path.is_file() and local_path.stat().st_size == size:
                    skipped += 1
                    continue
                replacing = local_path.is_file()
                partial = local_path.with_name(local_path.name + ".part")
                sftp.get(remote_path, str(partial))
                partial.replace(local_path)
                if replacing:
                    updated.append(name)
                else:
                    added.append(name)
            local_count = sum(1 for path in OUT_ROOT.glob("*.png") if path.is_file())
            log(
                f"remote={len(files)} new={len(added)} updated={len(updated)} "
                f"skipped={skipped} local={local_count} "
                f"added={name_list(added)} updated_files={name_list(updated)} "
                f"from {remote_dir}"
            )
        finally:
            sftp.close()
    finally:
        client.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"FAILED {type(error).__name__}: {error}")
        sys.exit(1)
