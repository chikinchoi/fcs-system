/**
 * Pull the current database code from an Oracle schema: procedures,
 * functions, packages, package bodies, triggers, and table schema.
 *
 * Read only. The session is SET TRANSACTION READ ONLY. The only statements
 * are dictionary selects. Nothing is inserted, updated, or deleted, and no
 * DDL is sent. Table files are column, key, index, and comment definitions.
 * They do not contain table rows, except the two data backups below.
 *
 * Each run writes a new folder under out_<environment>/. Program source
 * comes from ALL_SOURCE, with LAST_DDL_TIME from ALL_OBJECTS. Trigger text
 * comes from ALL_TRIGGERS, because this login can see the trigger body there
 * and cannot see those triggers in ALL_OBJECTS or ALL_SOURCE. Table schema
 * comes from ALL_TABLES, ALL_TAB_COLUMNS, ALL_CONSTRAINTS, ALL_INDEXES, and
 * the comment views. Row backups for FCS_CONFIG_PARAMETER,
 * FC_HOSPITAL_CODES, and HOSP_STATION_MAPPING are written under data/.
 * FC_HOSPITAL_CDE is not a table in this schema; the hospital rows come
 * from FC_HOSPITAL_CODES.
 *
 * Credentials live in a gitignored JSON next to this file, or in
 * FCS_DB_CONNECT, FCS_DB_USER, and FCS_DB_PASSWORD. FCS_DB_OWNER overrides
 * the schema. An empty owner means the login user.
 *
 * SIT uses db.sit.json. UAT uses db.uat.json. Production uses db.prod.json.
 * The file name sets the output folder: out_sit, out_uat, or out_prod.
 * An optional label in the JSON overrides that folder name.
 *
 *   node self-scripts/pull-db-code/pull-db-code.js
 *   node self-scripts/pull-db-code/pull-db-code.js db.uat.json
 *   node self-scripts/pull-db-code/pull-db-code.js db.prod.json
 */

var fs = require("fs");
var path = require("path");

var oracledb;
try { oracledb = require("oracledb"); }
catch (e) { oracledb = null; }

var HERE = __dirname;

function configPath() {
  var arg = process.argv[2] ? String(process.argv[2]).trim() : "";
  if (!arg) return path.join(HERE, "db.sit.json");
  if (arg.indexOf("..") !== -1 || /[\\/]/.test(arg)) {
    throw new Error("Pass only a file name in this folder, such as db.prod.json.");
  }
  return path.join(HERE, arg);
}

var TYPES = ["PROCEDURE", "FUNCTION", "PACKAGE", "PACKAGE BODY", "TRIGGER"];
var DATA_TABLES = [
  { name: "FCS_CONFIG_PARAMETER", orderBy: "NAME" },
  { name: "FC_HOSPITAL_CDE", fallback: "FC_HOSPITAL_CODES", orderBy: "HOSPITAL_CDE" },
  { name: "HOSP_STATION_MAPPING", orderBy: ["HOSPITAL_CDE", "HOST_NAME", "STATION_ID"] }
];
var FOLDERS = {
  "PROCEDURE": "procedure",
  "FUNCTION": "function",
  "PACKAGE": "package",
  "PACKAGE BODY": "package-body",
  "TRIGGER": "trigger"
};

var OBJECTS_SQL =
  "SELECT object_name, object_type, status, " +
  "TO_CHAR(last_ddl_time, 'YYYY-MM-DD HH24:MI:SS') AS last_ddl_time " +
  "FROM all_objects " +
  "WHERE owner = :owner " +
  "AND object_type IN ('PROCEDURE','FUNCTION','PACKAGE','PACKAGE BODY','TRIGGER') " +
  "AND object_name NOT LIKE 'BIN$%' " +
  "ORDER BY object_type, object_name";

var TRIGGERS_SQL =
  "SELECT trigger_name, trigger_type, triggering_event, table_owner, table_name, " +
  "status, description, when_clause, trigger_body " +
  "FROM all_triggers " +
  "WHERE (owner = :owner OR table_owner = :owner) " +
  "AND trigger_name NOT LIKE 'BIN$%' " +
  "ORDER BY trigger_name";

var SOURCE_SQL =
  "SELECT name, type, line, text " +
  "FROM all_source " +
  "WHERE owner = :owner " +
  "AND type IN ('PROCEDURE','FUNCTION','PACKAGE','PACKAGE BODY','TRIGGER') " +
  "AND name NOT LIKE 'BIN$%' " +
  "ORDER BY type, name, line";

var TABLES_SQL =
  "SELECT t.table_name, t.temporary, t.duration, t.iot_type, t.partitioned, t.nested, " +
  "o.status, TO_CHAR(o.last_ddl_time, 'YYYY-MM-DD HH24:MI:SS') AS last_ddl_time, c.comments " +
  "FROM all_tables t " +
  "LEFT JOIN all_objects o ON o.owner = t.owner AND o.object_name = t.table_name AND o.object_type = 'TABLE' " +
  "LEFT JOIN all_tab_comments c ON c.owner = t.owner AND c.table_name = t.table_name AND c.table_type = 'TABLE' " +
  "WHERE t.owner = :owner AND t.table_name NOT LIKE 'BIN$%' AND NVL(t.secondary, 'N') = 'N' " +
  "ORDER BY t.table_name";

var COLUMNS_SQL =
  "SELECT table_name, column_name, column_id, data_type, data_length, data_precision, data_scale, " +
  "char_length, char_used, nullable, data_default " +
  "FROM all_tab_columns " +
  "WHERE owner = :owner AND table_name NOT LIKE 'BIN$%' " +
  "ORDER BY table_name, column_id";

var CONSTRAINTS_SQL =
  "SELECT constraint_name, constraint_type, table_name, search_condition_vc AS search_condition, " +
  "r_owner, r_constraint_name, delete_rule, status, index_name, generated " +
  "FROM all_constraints " +
  "WHERE owner = :owner AND table_name NOT LIKE 'BIN$%' AND constraint_type IN ('P','U','R','C') " +
  "ORDER BY table_name, constraint_type, constraint_name";

var CONSTRAINTS_SQL_NO_VC =
  "SELECT constraint_name, constraint_type, table_name, " +
  "CAST(NULL AS VARCHAR2(1)) AS search_condition, " +
  "r_owner, r_constraint_name, delete_rule, status, index_name, generated " +
  "FROM all_constraints " +
  "WHERE owner = :owner AND table_name NOT LIKE 'BIN$%' AND constraint_type IN ('P','U','R','C') " +
  "ORDER BY table_name, constraint_type, constraint_name";

var CONS_COLUMNS_SQL =
  "SELECT constraint_name, table_name, column_name, position " +
  "FROM all_cons_columns " +
  "WHERE owner = :owner AND table_name NOT LIKE 'BIN$%' " +
  "ORDER BY table_name, constraint_name, position";

var REF_COLUMNS_SQL =
  "SELECT fk.table_name AS child_table, fk.constraint_name, rc.owner AS ref_owner, " +
  "rc.table_name AS ref_table, rcc.column_name AS ref_column, rcc.position " +
  "FROM all_constraints fk " +
  "JOIN all_constraints rc ON rc.owner = fk.r_owner AND rc.constraint_name = fk.r_constraint_name " +
  "JOIN all_cons_columns rcc ON rcc.owner = rc.owner AND rcc.constraint_name = rc.constraint_name " +
  "WHERE fk.owner = :owner AND fk.constraint_type = 'R' AND fk.table_name NOT LIKE 'BIN$%' " +
  "ORDER BY fk.table_name, fk.constraint_name, rcc.position";

var INDEXES_SQL =
  "SELECT index_name, table_name, uniqueness, index_type, status " +
  "FROM all_indexes " +
  "WHERE table_owner = :owner AND table_name NOT LIKE 'BIN$%' " +
  "ORDER BY table_name, index_name";

var IND_COLUMNS_SQL =
  "SELECT index_name, table_name, column_name, column_position, descend " +
  "FROM all_ind_columns " +
  "WHERE table_owner = :owner AND table_name NOT LIKE 'BIN$%' " +
  "ORDER BY table_name, index_name, column_position";

var IND_COLUMNS_SQL_NO_DESC =
  "SELECT index_name, table_name, column_name, column_position, CAST(NULL AS VARCHAR2(4)) AS descend " +
  "FROM all_ind_columns " +
  "WHERE table_owner = :owner AND table_name NOT LIKE 'BIN$%' " +
  "ORDER BY table_name, index_name, column_position";

var COL_COMMENTS_SQL =
  "SELECT table_name, column_name, comments " +
  "FROM all_col_comments " +
  "WHERE owner = :owner AND table_name NOT LIKE 'BIN$%' AND comments IS NOT NULL " +
  "ORDER BY table_name, column_name";

function easyConnect(raw) {
  var text = String(raw || "").trim().replace(/\s+/g, "");
  text = text.replace(/^jdbc:oracle:thin:@/i, "");
  if (text.charAt(0) === "@") text = text.slice(1);
  if (/^\(DESCRIPTION=/i.test(text)) return text;
  var sid = text.match(/^([A-Za-z0-9._-]+):(\d+):([A-Za-z0-9._-]+)$/);
  if (sid) {
    return "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=" + sid[1] + ")(PORT=" + sid[2] + "))(CONNECT_DATA=(SID=" + sid[3] + ")))";
  }
  var service = text.match(/^(?:\/\/)?([A-Za-z0-9._-]+):(\d+)\/([A-Za-z0-9._-]+)/);
  if (!service) return text;
  return service[1] + ":" + service[2] + "/" + service[3];
}

function ident(value, label) {
  var text = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9_$#]{1,128}$/.test(text)) {
    throw new Error(label + " must be letters, digits, and _ $ #.");
  }
  return text;
}

function loadConfig() {
  var configFile = configPath();
  var file = {};
  if (fs.existsSync(configFile)) {
    file = JSON.parse(fs.readFileSync(configFile, "utf8"));
  }
  var connectString = easyConnect(process.env.FCS_DB_CONNECT || file.connectString);
  var user = String(process.env.FCS_DB_USER || file.user || "").trim();
  var password = String(process.env.FCS_DB_PASSWORD || file.password || "");
  var ownerRaw = process.env.FCS_DB_OWNER || file.owner || "";
  var labelRaw = String(file.label || "").trim().toLowerCase();
  if (!labelRaw) {
    var named = path.basename(configFile).toLowerCase().match(/^db\.([a-z0-9][a-z0-9_-]{0,31})\.json$/);
    labelRaw = named ? named[1] : "sit";
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(labelRaw)) {
    throw new Error("label must be letters, digits, _ or -, up to 32 characters.");
  }
  if (!connectString || !user || !password) {
    throw new Error("Connection string, username, and password are required. Put them in " + configFile + " or FCS_DB_CONNECT, FCS_DB_USER, and FCS_DB_PASSWORD.");
  }
  if (connectString.length > 500) throw new Error("Connection string is too long.");
  user = ident(user, "Username");
  var owner = String(ownerRaw).trim() ? ident(ownerRaw, "Owner") : user;
  if (password.length > 128 || /[\r\n\0]/.test(password)) throw new Error("Password is too long.");
  return { connectString: connectString, user: user, password: password, owner: owner, label: labelRaw, configFile: configFile };
}

function stamp() {
  var d = new Date();
  function p(n) { return String(n).padStart(2, "0"); }
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function fileName(name) {
  return String(name).replace(/[^A-Za-z0-9_$#.-]/g, "_") + ".sql";
}

function header(owner, meta) {
  return "-- " + owner + "." + meta.object_name + "\n" +
    "-- " + meta.object_type + "\n" +
    "-- STATUS " + (meta.status || "") + "\n" +
    "-- LAST_DDL_TIME " + (meta.last_ddl_time || "") + "\n";
}

async function readObjects(conn, owner) {
  var result = await conn.execute(OBJECTS_SQL, { owner: owner }, { maxRows: 100000 });
  var map = {};
  (result.rows || []).forEach(function (row) {
    map[row.OBJECT_TYPE + "\0" + row.OBJECT_NAME] = {
      object_name: row.OBJECT_NAME,
      object_type: row.OBJECT_TYPE,
      status: row.STATUS,
      last_ddl_time: row.LAST_DDL_TIME
    };
  });
  return map;
}

async function writeSource(conn, owner, objects, dir) {
  var result = await conn.execute(SOURCE_SQL, { owner: owner }, { resultSet: true, fetchArraySize: 1000 });
  var rs = result.resultSet;
  var currentKey = "";
  var chunks = [];
  var written = [];
  try {
    var batch;
    while ((batch = await rs.getRows(1000)).length) {
      for (var i = 0; i < batch.length; i++) {
        var row = batch[i];
        var key = row.TYPE + "\0" + row.NAME;
        if (key !== currentKey) {
          if (currentKey) written.push(flush(owner, objects, dir, currentKey, chunks));
          currentKey = key;
          chunks = [];
        }
        chunks.push(row.TEXT == null ? "" : String(row.TEXT));
      }
    }
    if (currentKey) written.push(flush(owner, objects, dir, currentKey, chunks));
  } finally {
    await rs.close();
  }
  return written;
}

function flush(owner, objects, dir, key, chunks) {
  var meta = objects[key];
  var parts = key.split("\0");
  var type = parts[0];
  var name = parts[1];
  if (!meta) {
    meta = { object_name: name, object_type: type, status: "", last_ddl_time: "" };
  }
  var folder = path.join(dir, FOLDERS[type] || "other");
  fs.mkdirSync(folder, { recursive: true });
  var body = chunks.join("");
  if (body.length && body.charAt(body.length - 1) !== "\n") body += "\n";
  var full = path.join(folder, fileName(name));
  fs.writeFileSync(full, header(owner, meta) + body, "utf8");
  return {
    owner: owner,
    name: name,
    type: type,
    status: meta.status,
    last_ddl_time: meta.last_ddl_time,
    lines: chunks.length,
    file: path.relative(dir, full)
  };
}

function quoteIdent(name) {
  var text = String(name || "");
  if (/^[A-Z][A-Z0-9_$#]*$/.test(text)) return text;
  return "\"" + text.replace(/"/g, "\"\"") + "\"";
}

function sqlString(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function columnType(row) {
  var dataType = String(row.DATA_TYPE || "");
  var upper = dataType.toUpperCase();
  if (upper === "VARCHAR2" || upper === "CHAR" || upper === "NVARCHAR2" || upper === "NCHAR") {
    var length = row.CHAR_USED === "C" || upper.charAt(0) === "N" ? row.CHAR_LENGTH : row.DATA_LENGTH;
    var unit = upper.charAt(0) === "N" ? "" : (row.CHAR_USED === "C" ? " CHAR" : " BYTE");
    return dataType + "(" + length + unit + ")";
  }
  if (upper === "RAW") return "RAW(" + row.DATA_LENGTH + ")";
  if (upper === "NUMBER" || upper === "FLOAT" || upper === "DECIMAL") {
    if (row.DATA_PRECISION == null && row.DATA_SCALE == null) return dataType;
    if (row.DATA_PRECISION == null) return dataType + "(*," + row.DATA_SCALE + ")";
    if (row.DATA_SCALE == null || Number(row.DATA_SCALE) === 0) return dataType + "(" + row.DATA_PRECISION + ")";
    return dataType + "(" + row.DATA_PRECISION + "," + row.DATA_SCALE + ")";
  }
  return dataType;
}

function cleanDefault(value) {
  if (value == null) return "";
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

function listGroup(rows, nameKey) {
  var map = {};
  (rows || []).forEach(function (row) {
    var key = row[nameKey];
    if (!map[key]) map[key] = [];
    map[key].push(row);
  });
  return map;
}

async function selectAll(conn, sql, owner) {
  var result = await conn.execute(sql, { owner: owner }, { resultSet: true, fetchArraySize: 1000 });
  var rs = result.resultSet;
  var rows = [];
  try {
    var batch;
    while ((batch = await rs.getRows(1000)).length) {
      rows = rows.concat(batch);
    }
  } finally {
    await rs.close();
  }
  return rows;
}

function renderTable(owner, table, columns, constraints, consColumns, refs, indexes, indColumns, colComments) {
  var lines = [];
  lines.push("-- " + owner + "." + table.TABLE_NAME);
  lines.push("-- TABLE");
  lines.push("-- STATUS " + (table.STATUS || ""));
  lines.push("-- LAST_DDL_TIME " + (table.LAST_DDL_TIME || ""));
  lines.push("-- TEMPORARY " + (table.TEMPORARY || ""));
  if (table.DURATION) lines.push("-- DURATION " + table.DURATION);
  if (table.IOT_TYPE) lines.push("-- IOT_TYPE " + table.IOT_TYPE);
  lines.push("-- PARTITIONED " + (table.PARTITIONED || ""));
  if (table.NESTED && table.NESTED !== "NO") lines.push("-- NESTED " + table.NESTED);
  if (table.COMMENTS) lines.push("-- COMMENT " + String(table.COMMENTS).replace(/[\r\n]+/g, " "));
  lines.push("");
  lines.push("CREATE TABLE " + quoteIdent(owner) + "." + quoteIdent(table.TABLE_NAME) + " (");
  var colLines = (columns || []).map(function (col) {
    var piece = "    " + quoteIdent(col.COLUMN_NAME) + " " + columnType(col);
    var def = cleanDefault(col.DATA_DEFAULT);
    if (def) piece += " DEFAULT " + def;
    if (col.NULLABLE === "N") piece += " NOT NULL";
    return piece;
  });
  lines.push(colLines.join(",\n"));
  lines.push(");");
  if (table.COMMENTS) {
    lines.push("");
    lines.push("COMMENT ON TABLE " + quoteIdent(owner) + "." + quoteIdent(table.TABLE_NAME) + " IS " + sqlString(table.COMMENTS) + ";");
  }
  (colComments || []).forEach(function (col) {
    lines.push("COMMENT ON COLUMN " + quoteIdent(owner) + "." + quoteIdent(table.TABLE_NAME) + "." + quoteIdent(col.COLUMN_NAME) + " IS " + sqlString(col.COMMENTS) + ";");
  });
  var constraintIndexes = {};
  (constraints || []).forEach(function (con) {
    if (con.INDEX_NAME) constraintIndexes[con.INDEX_NAME] = true;
    if (con.CONSTRAINT_TYPE === "C") {
      var search = cleanDefault(con.SEARCH_CONDITION);
      if (!search) return;
      if (con.GENERATED === "GENERATED NAME" && /IS\s+NOT\s+NULL$/i.test(search)) return;
      lines.push("ALTER TABLE " + quoteIdent(owner) + "." + quoteIdent(table.TABLE_NAME) + " ADD CONSTRAINT " + quoteIdent(con.CONSTRAINT_NAME) + " CHECK (" + search + ");");
      return;
    }
    var cols = (consColumns[con.CONSTRAINT_NAME] || []).map(function (col) { return quoteIdent(col.COLUMN_NAME); });
    if (!cols.length) return;
    var clause = "ALTER TABLE " + quoteIdent(owner) + "." + quoteIdent(table.TABLE_NAME) + " ADD CONSTRAINT " + quoteIdent(con.CONSTRAINT_NAME);
    if (con.CONSTRAINT_TYPE === "P") clause += " PRIMARY KEY (" + cols.join(", ") + ")";
    else if (con.CONSTRAINT_TYPE === "U") clause += " UNIQUE (" + cols.join(", ") + ")";
    else if (con.CONSTRAINT_TYPE === "R") {
      var refCols = (refs[con.CONSTRAINT_NAME] || []);
      var refOwner = refCols.length ? refCols[0].REF_OWNER : con.R_OWNER;
      var refTable = refCols.length ? refCols[0].REF_TABLE : "";
      var refList = refCols.map(function (col) { return quoteIdent(col.REF_COLUMN); });
      clause += " FOREIGN KEY (" + cols.join(", ") + ")";
      if (refTable) clause += " REFERENCES " + quoteIdent(refOwner) + "." + quoteIdent(refTable) + " (" + refList.join(", ") + ")";
      else if (con.R_CONSTRAINT_NAME) clause += " REFERENCES " + quoteIdent(con.R_OWNER) + "." + quoteIdent(con.R_CONSTRAINT_NAME);
      if (con.DELETE_RULE && con.DELETE_RULE !== "NO ACTION") clause += " ON DELETE " + con.DELETE_RULE;
    } else {
      return;
    }
    if (con.STATUS && con.STATUS !== "ENABLED") clause += " DISABLE";
    lines.push(clause + ";");
  });
  (indexes || []).forEach(function (idx) {
    if (constraintIndexes[idx.INDEX_NAME]) return;
    if (idx.INDEX_TYPE === "LOB") return;
    var cols = (indColumns[idx.INDEX_NAME] || []).map(function (col) {
      return quoteIdent(col.COLUMN_NAME) + (col.DESCEND === "DESC" ? " DESC" : "");
    });
    if (!cols.length) return;
    var unique = idx.UNIQUENESS === "UNIQUE" ? "UNIQUE " : "";
    lines.push("CREATE " + unique + "INDEX " + quoteIdent(owner) + "." + quoteIdent(idx.INDEX_NAME) + " ON " + quoteIdent(owner) + "." + quoteIdent(table.TABLE_NAME) + " (" + cols.join(", ") + ");");
  });
  lines.push("");
  return lines.join("\n");
}

async function writeTables(conn, owner, dir) {
  var tables = await selectAll(conn, TABLES_SQL, owner);
  var columns = listGroup(await selectAll(conn, COLUMNS_SQL, owner), "TABLE_NAME");
  var constraints;
  try {
    constraints = await selectAll(conn, CONSTRAINTS_SQL, owner);
  } catch (err) {
    if (!err || err.errorNum !== 904) throw err;
    constraints = await selectAll(conn, CONSTRAINTS_SQL_NO_VC, owner);
  }
  var constraintsByTable = listGroup(constraints, "TABLE_NAME");
  var consColumns = listGroup(await selectAll(conn, CONS_COLUMNS_SQL, owner), "CONSTRAINT_NAME");
  var refs = listGroup(await selectAll(conn, REF_COLUMNS_SQL, owner), "CONSTRAINT_NAME");
  var indexes = listGroup(await selectAll(conn, INDEXES_SQL, owner), "TABLE_NAME");
  var indexColumns;
  try {
    indexColumns = await selectAll(conn, IND_COLUMNS_SQL, owner);
  } catch (err) {
    if (!err || err.errorNum !== 904) throw err;
    indexColumns = await selectAll(conn, IND_COLUMNS_SQL_NO_DESC, owner);
  }
  var indColumns = listGroup(indexColumns, "INDEX_NAME");
  var colComments = listGroup(await selectAll(conn, COL_COMMENTS_SQL, owner), "TABLE_NAME");
  var folder = path.join(dir, "table");
  fs.mkdirSync(folder, { recursive: true });
  return tables.map(function (table) {
    var name = table.TABLE_NAME;
    var body = renderTable(owner, table, columns[name], constraintsByTable[name], consColumns, refs, indexes[name], indColumns, colComments[name]);
    var full = path.join(folder, fileName(name));
    fs.writeFileSync(full, body, "utf8");
    return {
      owner: owner,
      name: name,
      type: "TABLE",
      status: table.STATUS || "",
      last_ddl_time: table.LAST_DDL_TIME || "",
      lines: (columns[name] || []).length,
      file: path.relative(dir, full)
    };
  });
}

var DATA_COLUMNS_SQL =
  "SELECT column_name, column_id, data_type " +
  "FROM all_tab_columns " +
  "WHERE owner = :owner AND table_name = :tableName " +
  "ORDER BY column_id";

var DATA_EXISTS_SQL =
  "SELECT table_name FROM all_tables " +
  "WHERE owner = :owner AND table_name = :tableName";

async function resolveDataTable(conn, owner, spec) {
  var wanted = ident(spec.name, "Data table");
  var found = await conn.execute(DATA_EXISTS_SQL, { owner: owner, tableName: wanted }, { maxRows: 1 });
  if (found.rows && found.rows.length) return { name: wanted, requested: wanted };
  if (!spec.fallback) throw new Error("Table " + owner + "." + wanted + " was not found.");
  var fallback = ident(spec.fallback, "Data table");
  var alt = await conn.execute(DATA_EXISTS_SQL, { owner: owner, tableName: fallback }, { maxRows: 1 });
  if (!alt.rows || !alt.rows.length) throw new Error("Table " + owner + "." + wanted + " was not found.");
  return { name: fallback, requested: wanted };
}

function orderClause(columns, orderBy) {
  var names = Array.isArray(orderBy) ? orderBy : (orderBy ? [orderBy] : []);
  var present = names.map(function (name) { return String(name).toUpperCase(); }).filter(function (name) {
    return columns.some(function (col) { return col.COLUMN_NAME === name; });
  });
  if (!present.length) return "";
  return " ORDER BY " + present.map(quoteIdent).join(", ");
}

function dataSelectList(columns) {
  return columns.map(function (col) {
    var name = quoteIdent(col.COLUMN_NAME);
    var dataType = String(col.DATA_TYPE || "").toUpperCase();
    if (dataType === "DATE") return "TO_CHAR(" + name + ", 'YYYY-MM-DD HH24:MI:SS') AS " + name;
    if (dataType.indexOf("TIMESTAMP") === 0) return "TO_CHAR(" + name + ", 'YYYY-MM-DD HH24:MI:SS.FF6') AS " + name;
    return name;
  }).join(", ");
}

async function writeDataTables(conn, owner, dir) {
  var folder = path.join(dir, "data");
  fs.mkdirSync(folder, { recursive: true });
  var written = [];
  for (var i = 0; i < DATA_TABLES.length; i++) {
    var spec = DATA_TABLES[i];
    var resolved = await resolveDataTable(conn, owner, spec);
    var columnsResult = await conn.execute(DATA_COLUMNS_SQL, { owner: owner, tableName: resolved.name }, { maxRows: 1000 });
    var columns = columnsResult.rows || [];
    if (!columns.length) throw new Error("Table " + owner + "." + resolved.name + " has no visible columns.");
    var sql = "SELECT " + dataSelectList(columns) + " FROM " + quoteIdent(owner) + "." + quoteIdent(resolved.name);
    sql += orderClause(columns, spec.orderBy);
    var result = await conn.execute(sql, {}, { resultSet: true, fetchArraySize: 500 });
    var rs = result.resultSet;
    var rows = [];
    try {
      var batch;
      while ((batch = await rs.getRows(500)).length) {
        rows = rows.concat(batch);
        if (rows.length > 100000) throw new Error("Table " + resolved.name + " has more than 100000 rows. The backup stopped.");
      }
    } finally {
      await rs.close();
    }
    var full = path.join(folder, fileName(resolved.name).replace(/\.sql$/, ".json"));
    var payload = {
      owner: owner,
      table: resolved.name,
      requested_name: resolved.requested,
      read_only: true,
      row_count: rows.length,
      columns: columns.map(function (col) { return col.COLUMN_NAME; }),
      rows: rows
    };
    fs.writeFileSync(full, JSON.stringify(payload, null, 2), "utf8");
    written.push({
      owner: owner,
      name: resolved.name,
      type: "DATA",
      status: "",
      last_ddl_time: "",
      lines: rows.length,
      file: path.relative(dir, full),
      note: resolved.requested === resolved.name ? "" : "Requested " + resolved.requested + ". That table is not in this schema."
    });
    console.log("DATA " + resolved.name + ": " + rows.length + " rows");
  }
  return written;
}

function triggerText(row) {
  var description = String(row.DESCRIPTION || "").replace(/\s+$/g, "");
  var whenClause = String(row.WHEN_CLAUSE || "").trim();
  var body = row.TRIGGER_BODY == null ? "" : String(row.TRIGGER_BODY).replace(/\s+$/g, "");
  var lines = [];
  lines.push("-- " + (row.TABLE_OWNER || "") + "." + row.TRIGGER_NAME);
  lines.push("-- TRIGGER");
  lines.push("-- STATUS " + (row.STATUS || ""));
  lines.push("-- TABLE " + (row.TABLE_OWNER || "") + "." + (row.TABLE_NAME || ""));
  lines.push("-- TRIGGER_TYPE " + (row.TRIGGER_TYPE || ""));
  lines.push("-- TRIGGERING_EVENT " + (row.TRIGGERING_EVENT || ""));
  lines.push("");
  lines.push("CREATE OR REPLACE TRIGGER " + (description || quoteIdent(row.TRIGGER_NAME)));
  if (whenClause && description.toUpperCase().indexOf(whenClause.toUpperCase()) === -1) {
    lines.push("WHEN (" + whenClause + ")");
  }
  if (body) lines.push(body);
  lines.push("");
  return lines.join("\n");
}

async function writeTriggers(conn, owner, dir, already) {
  var result = await conn.execute(TRIGGERS_SQL, { owner: owner }, { resultSet: true, fetchArraySize: 50 });
  var rs = result.resultSet;
  var folder = path.join(dir, "trigger");
  var written = [];
  try {
    var batch;
    while ((batch = await rs.getRows(50)).length) {
      for (var i = 0; i < batch.length; i++) {
        var row = batch[i];
        if (already[row.TRIGGER_NAME]) continue;
        fs.mkdirSync(folder, { recursive: true });
        var full = path.join(folder, fileName(row.TRIGGER_NAME));
        var text = triggerText(row);
        fs.writeFileSync(full, text, "utf8");
        written.push({
          owner: owner,
          name: row.TRIGGER_NAME,
          type: "TRIGGER",
          status: row.STATUS || "",
          last_ddl_time: "",
          lines: text.split("\n").length,
          file: path.relative(dir, full),
          note: row.TRIGGER_BODY ? "" : "ALL_TRIGGERS returned no trigger body."
        });
      }
    }
  } finally {
    await rs.close();
  }
  return written;
}

function safeMessage(err) {
  var num = err && err.errorNum;
  if (num === 1017) return "The database refused this username or password.";
  if (num === 12154 || num === 12514 || num === 12541 || num === 12545) return "The database address could not be reached.";
  if (num === 28000) return "The account is locked.";
  return String(err && err.message || err);
}

async function main() {
  if (!oracledb) {
    throw new Error("The database driver is not installed. In the fcs-system folder run npm install, then run this script again.");
  }
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  oracledb.autoCommit = false;
  var cred = loadConfig();
  var dir = path.join(HERE, "out_" + cred.label, stamp());
  fs.mkdirSync(dir, { recursive: true });
  var conn;
  try {
    conn = await oracledb.getConnection({
      user: cred.user,
      password: cred.password,
      connectString: cred.connectString,
      connectTimeout: 15
    });
    conn.callTimeout = 300000;
    await conn.execute("SET TRANSACTION READ ONLY");
    console.log("Connected as " + cred.user + ". Reading " + cred.owner + " (" + cred.label + "). Read only.");
    var objects = await readObjects(conn, cred.owner);
    var written = await writeSource(conn, cred.owner, objects, dir);
    var alreadyTriggers = {};
    written.forEach(function (item) {
      if (item.type === "TRIGGER") alreadyTriggers[item.name] = true;
    });
    var triggers = await writeTriggers(conn, cred.owner, dir, alreadyTriggers);
    written = written.concat(triggers);
    var tables = await writeTables(conn, cred.owner, dir);
    var dataTables = await writeDataTables(conn, cred.owner, dir);
    written = written.concat(tables, dataTables);
    var seen = {};
    written.forEach(function (item) { seen[item.type + "\0" + item.name] = true; });
    Object.keys(objects).forEach(function (key) {
      if (seen[key]) return;
      var meta = objects[key];
      written.push({
        owner: cred.owner,
        name: meta.object_name,
        type: meta.object_type,
        status: meta.status,
        last_ddl_time: meta.last_ddl_time,
        lines: 0,
        file: "",
        note: "No rows in ALL_SOURCE. Wrapped or empty source is not stored as text."
      });
    });
    written.sort(function (a, b) {
      if (a.type < b.type) return -1;
      if (a.type > b.type) return 1;
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    });
    var counts = {};
    TYPES.forEach(function (type) { counts[type] = 0; });
    written.forEach(function (item) {
      counts[item.type] = (counts[item.type] || 0) + 1;
    });
    var manifest = {
      label: cred.label,
      owner: cred.owner,
      read_only: true,
      pulled_at: new Date().toISOString(),
      counts: counts,
      objects: written
    };
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    console.log("Wrote " + written.length + " objects to " + dir);
    TYPES.forEach(function (type) {
      console.log(type + ": " + counts[type]);
    });
    console.log("TABLE: " + (counts.TABLE || 0));
    console.log("DATA: " + (counts.DATA || 0));
  } finally {
    if (conn) {
      try { await conn.close(); }
      catch (e) { console.error("Close failed: " + safeMessage(e)); }
    }
  }
}

main().catch(function (err) {
  console.error(safeMessage(err));
  process.exitCode = 1;
});
