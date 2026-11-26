var oracledb;
try { oracledb = require("oracledb"); }
catch (e) { oracledb = null; }

var healthDb = require("./health-db");

if (oracledb) {
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  oracledb.autoCommit = false;
}

var busy = false;
var current = null;
var CALL_MS = 8000;
var NAMES = ["TLOG_MED_PROFILE_CHARGE_HDR", "TLOG_MED_PROFILE_CHARGE_DETAIL"];
var SPECS = [
  { table: "TLOG_MED_PROFILE_CHARGE_HDR", source: "tlog_med_profile_charge_hdr", label: "Header log" },
  { table: "TLOG_MED_PROFILE_CHARGE_DETAIL", source: "tlog_med_profile_charge_detail", label: "Detail log" }
];

function run(msg, done, res) {
  var cred = check(msg || {});
  if (cred.error) return done(400, { error: cred.error });
  if (!oracledb) {
    return done(503, { error: "The database driver is not installed. In this folder run npm install, then start the runner again." });
  }
  if (busy) return done(429, { error: "A CMS path check is already running. Wait for it to finish." });
  var job = { conn: null, cancelled: false, done: false };
  busy = true;
  current = job;
  if (res) {
    res.on("close", function () {
      if (!res.writableEnded && !job.done) cancelJob(job);
    });
  }
  work(cred, job).then(function (body) {
    done(200, body);
  }).catch(function (err) {
    if (job.cancelled) err.disconnected = true;
    done(502, { error: safeMessage(err) });
  }).then(function () {
    job.done = true;
    if (current === job) current = null;
    busy = false;
  });
}

function disconnect(done) {
  var job = current;
  if (!job) return done(200, { released: true, open: false });
  cancelJob(job);
  var started = Date.now();
  function finish() {
    done(200, { released: !busy, open: !!current });
  }
  function waitDone() {
    if (!busy || Date.now() - started > 4000) return finish();
    setTimeout(waitDone, 50);
  }
  waitDone();
}

function cancelJob(job) {
  if (!job || job.cancelled) return;
  job.cancelled = true;
  var conn = job.conn;
  if (conn && typeof conn.breakExecution === "function") {
    conn.breakExecution().catch(function () {});
  }
}

function check(msg) {
  var connectString = healthDb.easyConnect(msg.connectString);
  var user = String(msg.user || "").trim();
  var password = String(msg.password || "");
  var hospital = String(msg.hospital || "").trim().toUpperCase();
  var start = String(msg.start || "").trim();
  var end = String(msg.end || "").trim();
  if (!connectString || !user || !password) return { error: "Connection string, username, and password are required." };
  if (connectString.length > 500 || /[\r\n\0'"`;]|--|\/\*/.test(connectString) || /jdbc:/i.test(connectString)) {
    return { error: "Use host:port/service, or a jdbc:oracle:thin:@//host:port/service URL." };
  }
  if (!/^[A-Za-z0-9_$#.]{1,128}$/.test(user)) return { error: "Username is letters, digits, and _ $ # ." };
  if (password.length > 128 || /[\r\n\0]/.test(password)) return { error: "Password is too long." };
  if (hospital && !/^[A-Z0-9]{1,10}$/.test(hospital)) return { error: "Hospital is 1–10 letters or digits." };
  if (start && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) return { error: "Start is YYYY-MM-DDTHH:MM." };
  if (end && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end)) return { error: "End is YYYY-MM-DDTHH:MM." };
  if ((start && !end) || (!start && end)) return { error: "Enter both a start and an end." };
  return { connectString: connectString, user: user, password: password };
}

async function work(cred, job) {
  var conn;
  var out = { now: "", rows: [], sql: [] };
  try {
    conn = await oracledb.getConnection({
      user: cred.user,
      password: cred.password,
      connectString: cred.connectString,
      connectTimeout: 8
    });
    conn.callTimeout = CALL_MS;
    job.conn = conn;
    if (job.cancelled) throw disconnected();
    await conn.execute("SET TRANSACTION READ ONLY");
    if (job.cancelled) throw disconnected();
    var clock = await q(conn, "SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI:SS') AS now_txt FROM dual", {}, 1);
    out.now = clock[0] ? clock[0].NOW_TXT : "";
    var indexes = await loadIndexes(conn);
    for (var i = 0; i < SPECS.length; i++) {
      if (job.cancelled) throw disconnected();
      var stopped = await readOne(conn, job, out, indexes, SPECS[i]);
      if (stopped) break;
    }
    return out;
  } finally {
    job.conn = null;
    if (conn) {
      try { await conn.close(); } catch (e) { /* closed after a cancelled read */ }
    }
  }
}

async function readOne(conn, job, out, indexes, spec) {
  var shape = indexLead(indexes[spec.table], "TLOG_DTM");
  var maxSql = "SELECT TO_CHAR(MAX(tlog_dtm), 'YYYY-MM-DD HH24:MI:SS.FF3') AS latest FROM " + spec.source;
  var rowSql = "SELECT pat_hospcode, moe_ord_no, TO_CHAR(tlog_dtm, 'YYYY-MM-DD HH24:MI:SS') AS latest FROM " + spec.source + " WHERE tlog_dtm = TO_TIMESTAMP(:latest, 'YYYY-MM-DD HH24:MI:SS.FF3') AND ROWNUM = 1";
  if (shape !== "date" && shape !== "both") {
    out.rows.push({ label: spec.label, table: spec.source, ran: false, at: "", hospital: "", orderNo: "", reason: "No valid index leads with TLOG_DTM. " + indexBrief(indexes[spec.table]) });
    out.sql.push(spec.label + " was not run\n" + maxSql + "\n\n" + rowSql);
    return false;
  }
  out.sql.push(spec.label + " newest time\n" + maxSql);
  var maxRows;
  try {
    maxRows = await q(conn, maxSql, {}, 1);
  } catch (err) {
    if (job.cancelled) throw err;
    out.rows.push({ label: spec.label, table: spec.source, ran: false, at: "", hospital: "", orderNo: "", reason: safeMessage(err) });
    return true;
  }
  var latest = maxRows[0] && maxRows[0].LATEST ? String(maxRows[0].LATEST) : "";
  if (!latest) {
    out.rows.push({ label: spec.label, table: spec.source, ran: true, at: "", hospital: "", orderNo: "", reason: "" });
    return false;
  }
  out.sql.push(spec.label + " row\n" + rowSql + "\n-- :latest = " + latest);
  var rows;
  try {
    rows = await q(conn, rowSql, { latest: bindText(latest) }, 1);
  } catch (err) {
    if (job.cancelled) throw err;
    out.rows.push({ label: spec.label, table: spec.source, ran: false, at: latest, hospital: "", orderNo: "", reason: safeMessage(err) });
    return true;
  }
  var row = rows[0] || {};
  out.rows.push({
    label: spec.label,
    table: spec.source,
    ran: true,
    at: row.LATEST ? String(row.LATEST) : latest.slice(0, 19),
    hospital: row.PAT_HOSPCODE == null ? "" : String(row.PAT_HOSPCODE),
    orderNo: row.MOE_ORD_NO == null ? "" : String(row.MOE_ORD_NO),
    reason: ""
  });
  return false;
}

async function loadIndexes(conn) {
  var meRows = await q(conn, "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS me FROM dual", {}, 1);
  var me = meRows[0] ? meRows[0].ME : "";
  var synonyms = await q(conn,
    "SELECT synonym_name, table_owner, table_name, owner FROM all_synonyms WHERE synonym_name IN (" + inList(NAMES) + ") AND owner IN (:me, 'PUBLIC')",
    { me: me }, 8);
  var tables = await q(conn, "SELECT table_name FROM user_tables WHERE table_name IN (" + inList(NAMES) + ")", {}, 4);
  var found = {};
  tables.forEach(function (r) { found[r.TABLE_NAME] = { owner: me, name: r.TABLE_NAME }; });
  synonyms.forEach(function (r) {
    if (found[r.SYNONYM_NAME] && found[r.SYNONYM_NAME].owner === me) return;
    if (found[r.SYNONYM_NAME] && r.OWNER === "PUBLIC") return;
    found[r.SYNONYM_NAME] = { owner: r.TABLE_OWNER, name: r.TABLE_NAME };
  });
  var indexes = {};
  for (var i = 0; i < NAMES.length; i++) {
    var item = found[NAMES[i]];
    indexes[NAMES[i]] = [];
    if (!item) continue;
    indexes[NAMES[i]] = await q(conn,
      "SELECT ic.index_name, ic.column_name, ic.column_position, i.status FROM all_ind_columns ic JOIN all_indexes i ON i.owner = ic.index_owner AND i.index_name = ic.index_name WHERE ic.table_owner = :owner AND ic.table_name = :name AND ic.column_position <= 2",
      { owner: item.owner, name: item.name }, 40);
  }
  return indexes;
}

function indexLead(rows, dateCol) {
  var by = {};
  (rows || []).forEach(function (r) {
    if (r.STATUS !== "VALID") return;
    if (!by[r.INDEX_NAME]) by[r.INDEX_NAME] = [];
    by[r.INDEX_NAME].push(r);
  });
  var dateLead = false;
  Object.keys(by).forEach(function (name) {
    var cols = by[name].sort(function (a, b) { return Number(a.COLUMN_POSITION) - Number(b.COLUMN_POSITION); });
    if (cols[0] && cols[0].COLUMN_NAME === dateCol) dateLead = true;
  });
  return dateLead ? "date" : "";
}

function indexBrief(rows) {
  var by = {};
  (rows || []).forEach(function (r) {
    if (!by[r.INDEX_NAME]) by[r.INDEX_NAME] = [];
    by[r.INDEX_NAME].push(r);
  });
  var names = Object.keys(by);
  if (!names.length) return "No index columns were visible.";
  return names.map(function (name) {
    var cols = by[name].sort(function (a, b) { return Number(a.COLUMN_POSITION) - Number(b.COLUMN_POSITION); });
    return name + " (" + cols.map(function (col) { return col.COLUMN_NAME; }).join(", ") + ")";
  }).join("; ");
}

function inList(names) {
  return names.map(function (name) { return "'" + name + "'"; }).join(",");
}

function bindText(value) {
  return { val: value, type: oracledb.STRING, dir: oracledb.BIND_IN };
}

async function q(conn, sql, binds, maxRows) {
  var result = await conn.execute(sql, binds || {}, { maxRows: maxRows || 20 });
  return result.rows || [];
}

function disconnected() {
  var err = new Error("Disconnected. The database session was closed.");
  err.disconnected = true;
  return err;
}

function safeMessage(err) {
  if (err && err.disconnected) return "Disconnected. The database session was closed.";
  var num = err && err.errorNum;
  if (num === 1013) return "Disconnected. The database session was closed.";
  if (num === 1017) return "The database refused this username or password.";
  if (num === 12154 || num === 12514 || num === 12541 || num === 12545) return "The database address could not be reached.";
  var text = String(err && (err.message || err.code) || "");
  if (err.code === "NJS-510" || /call timeout|NJS-510|DPI-1067/i.test(text)) return "A read did not finish within 8 seconds. The check stopped. Nothing was written.";
  text = String(err && err.message || "The database check failed.").replace(/password[=:]\s*\S+/ig, "password");
  if (text.length > 280) text = text.slice(0, 280);
  return text;
}

module.exports = { run: run, disconnect: disconnect };
