# pull-log

Read-only download of FCS application logs. It replaces the FileZilla copy into `D:\FCS\remote-log`.

The script lists the configured directories and downloads the named files. It does not upload, delete, rename, or change anything on the server. A failed login stops the run at once and is not tried again.

## Setup

`paramiko` is already used by `pull-sit-receipt-png`. If import fails:

```text
py -3 -m pip install paramiko
```

The scheduled job and the commands below use these three files. Login for every host is `self-scripts/pull-server/servers.local.json`, shared with the receipt pull. These three files are gitignored.

```text
self-scripts/pull-server/pull-log/sit.json
self-scripts/pull-server/pull-log/uat.json
self-scripts/pull-server/pull-log/prod.json
```

Paths match the log4j locations: `/appl/pbrcbar/log/fcs`, `/appl/pbrcbar/log/kiosk`, and `/appl/pbrcbar/log/fcshapay`. Hosts are `eaptst72a`, `eaptst72e`, `eapsrv76a`, `eapsrv76b`, `eapsrv78a`, and `eapsrv78b`.

An empty password is refused before any login. A host with no password of its own uses `servers.local.json`.

## Run

From the `fcs-system` folder:

```text
py -3 self-scripts/pull-server/pull-log/pull-log.py sit
py -3 self-scripts/pull-server/pull-log/pull-log.py uat
py -3 self-scripts/pull-server/pull-log/pull-log.py prod
py -3 self-scripts/pull-server/pull-log/pull-log.py prod --primary 78
py -3 self-scripts/pull-server/pull-log/pull-log.py prod --all
```

`--dry-run` logs in once, lists the matching files, and does not download.

Run one environment at a time. `prod` pulls the pair named in `primary`. That is `76a` and `76b`. When production is running on the other pair, use `--primary 78`, or change `primary` in `prod.json` to `["78a", "78b"]`. `--all` pulls 76a, 76b, 78a, and 78b. If a login fails, the run stops and the remaining hosts are not contacted. If a host does not answer, that host is reported and the next selected host is tried once.

## What it downloads

Each `files` entry is one current log. `rotated_days` also takes siblings in the same directory whose names start with that file plus a dot, including `.gz`, when the remote modification time is inside the window. The scheduled pull uses 14 so a file still on the server is copied before the server deletes it. `0` downloads the current file only. At most 30 rotated siblings are taken per file. A local file of the same size is left in place. Files the server later removes stay on disk.

A rotated file keeps the local name and adds the remote suffix.

## Output

SIT goes to `D:\FCS\remote-log\pull-log\sit`. UAT goes to `D:\FCS\remote-log\pull-log\uat`. Production goes to `D:\FCS\remote-log\pull-log\prod`, with one folder per server:

```text
D:\FCS\remote-log\pull-log\prod\76a\
D:\FCS\remote-log\pull-log\prod\76b\
D:\FCS\remote-log\pull-log\prod\78a\
D:\FCS\remote-log\pull-log\prod\78b\
```

Each environment folder has `fcs`, `kiosk`, and `payha`. `fcs` holds `fcs_app.log` and `fcs_api.log`. `kiosk` holds `kiosk.log`. `payha` holds `fcshapay.log`. Rotated names stay in the same folder. The server folder is the only thing that distinguishes 76a from 76b. Change `local_dir` in the json to use another folder.

A download prints a line when it starts, about every 5 seconds while bytes are moving, and again when that file is saved. It is written to a `.partial` file and renamed only after it finishes. Ctrl+C deletes that partial file and does not log in again. The remote file is left untouched. `_pull_manifest.json` in the output folder lists what was saved. Passwords are not written there.

## Login

One password attempt per host. Key agent and key files are not used. A bad password exits with code 2 and the text `AUTHENTICATION FAILED`. The script does not reconnect that host and does not continue to the next host. A connection failure is also logged once as `No retry` and that host is not contacted again.
