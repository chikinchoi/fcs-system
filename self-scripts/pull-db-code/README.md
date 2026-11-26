# pull-db-code

Read-only pull of the current FCS database code. Each run writes a new timestamp folder. It does not insert, update, delete, or send DDL.

The pull contains:

- Procedures, functions, packages, package bodies, and triggers. Trigger text comes from `ALL_TRIGGERS`. This login cannot see those triggers in `ALL_SOURCE`.
- Table definitions: columns, defaults, keys, foreign keys, indexes, and comments
- Rows for `FCS_CONFIG_PARAMETER`, `FC_HOSPITAL_CODES`, and `HOSP_STATION_MAPPING`

Other tables are definitions, not row backups. `FC_HOSPITAL_CDE` is not a table in this schema. The hospital rows come from `FC_HOSPITAL_CODES`. Station rows are ordered by hospital, host name, and station id.

## Setup

From the `fcs-system` folder, install the driver once:

```text
npm install
```

Put one connection file next to `pull-db-code.js`. These files are gitignored.

`db.sit.json`

```json
{
  "connectString": "host:1521/service",
  "user": "SCHEMA_USER",
  "password": "",
  "owner": "FCS"
}
```

Copy that shape to `db.uat.json` and `db.prod.json`. `connectString` may be `host:port/service`, `host:port:sid`, or a JDBC thin URL. An empty `owner` uses the login user.

`FCS_DB_CONNECT`, `FCS_DB_USER`, `FCS_DB_PASSWORD`, and `FCS_DB_OWNER` override the file when they are set.

## Run

Use PowerShell, Command Prompt, or Git Bash. The commands are the same in all three. Open the shell, move to the `fcs-system` folder, then run one environment.

PowerShell or Command Prompt:

```text
cd C:\Users\CCK585\Desktop\workspace\fcs-system
node self-scripts/pull-db-code/pull-db-code.js
node self-scripts/pull-db-code/pull-db-code.js db.uat.json
node self-scripts/pull-db-code/pull-db-code.js db.prod.json
```

Git Bash:

```text
cd /c/Users/CCK585/Desktop/workspace/fcs-system
node self-scripts/pull-db-code/pull-db-code.js
node self-scripts/pull-db-code/pull-db-code.js db.uat.json
node self-scripts/pull-db-code/pull-db-code.js db.prod.json
```

Run only the line for the environment you want. The first `node` line is SIT and uses `db.sit.json`. The second is UAT. The third is production.

The file name chooses the output folder: `out_sit`, `out_uat`, or `out_prod`. To use another name, pass `db.<name>.json` or set `"label"` in the JSON.

## Output

```text
self-scripts/pull-db-code/out_sit/YYYYMMDD_HHMMSS/
  procedure/
  function/
  package/
  package-body/
  trigger/
  table/
  data/
  manifest.json
```

UAT and production use `out_uat` and `out_prod`. The greatest timestamp name is the latest pull. `manifest.json` lists every object and its file. Output folders are gitignored.
