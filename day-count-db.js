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
var NAMES = ["FC_DRUG_CHARGING", "FC_CASE_SERVICES"];
var SPECS = [
  { id: "charge", title: "Drug charging", table: "FC_DRUG_CHARGING", source: "fc_drug_charging", dateCol: "FC_UPD_DTM", hospCol: "HOSPITAL_CDE" },
  { id: "case", title: "Case services", table: "FC_CASE_SERVICES", source: "fc_case_services", dateCol: "UPD_DTM", hospCol: "HOSPITAL_CDE" }
];

function run(msg, done, res) {
  var cred = check(msg || {});
  if (cred.error) return done(400, { error: cred.error });
  if (!oracledb) {
    return done(503, { error: "The database driver is not installed. In this folder run npm install, then start the runner again." });
  }
  if (busy) return done(429, { error: "A day count is already running. Wait for it to finish." });
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
  var day = String(msg.day || "").trim();
  if (!connectString || !user || !password) return { error: "Connection string, username, and password are required." };
  if (connectString.length > 500 || /[\r\n\0'"`;]|--|\/\*/.test(connectString) || /jdbc:/i.test(connectString)) {
    return { error: "Use host:port/service, or a jdbc:oracle:thin:@//host:port/service URL." };
  }
  if (!/^[A-Za-z0-9_$#.]{1,128}$/.test(user)) return { error: "Username is letters, digits, and _ $ # ." };
  if (password.length > 128 || /[\r\n\0]/.test(password)) return { error: "Password is too long." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Day is YYYY-MM-DD." };
  return { connectString: connectString, user: user, password: password, day: day };
}

async function work(cred, job) {
  var conn;
  var out = { day: cred.day, now: "", rows: [], charge: { ran: false, reason: "" }, case: { ran: false, reason: "" }, sql: [] };
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
    var hospitals = await hospitalCodes(conn);
    var byHosp = {};
    hospitals.forEach(function (code) { byHosp[code] = { hospital: code, charge: null, case: null }; });
    for (var i = 0; i < SPECS.length; i++) {
      if (job.cancelled) throw disconnected();
      await countOne(conn, cred, job, indexes, hospitals, byHosp, out, SPECS[i]);
    }
    out.rows = Object.keys(byHosp).sort().map(function (code) { return byHosp[code]; });
    return out;
  } finally {
    job.conn = null;
    if (conn) {
      try { await conn.close(); } catch (e) { /* closed after a cancelled read */ }
    }
  }
}

async function countOne(conn, cred, job, indexes, hospitals, byHosp, out, spec) {
  var shape = indexLead(indexes[spec.table], spec.dateCol, spec.hospCol);
  var dateCol = spec.dateCol.toLowerCase();
  var hospCol = spec.hospCol.toLowerCase();
  if (shape === "date" || shape === "both") {
    var sql = "SELECT " + hospCol + " AS hosp, COUNT(*) AS cnt FROM " + spec.source + " WHERE " + dateCol + " >= TO_DATE(:day, 'YYYY-MM-DD') AND " + dateCol + " < TO_DATE(:day, 'YYYY-MM-DD') + 1 GROUP BY " + hospCol;
    var rows = await q(conn, sql, { day: bindText(cred.day) }, 200);
    rows.forEach(function (row) {
      var code = String(row.HOSP || "").trim();
      if (!code) return;
      if (!byHosp[code]) byHosp[code] = { hospital: code, charge: null, case: null };
      byHosp[code][spec.id] = Number(row.CNT || 0);
    });
    hospitals.forEach(function (code) {
      if (byHosp[code][spec.id] == null) byHosp[code][spec.id] = 0;
    });
    out[spec.id] = { ran: true, reason: "" };
    out.sql.push(spec.title + "\n" + sql);
    return;
  }
  if (shape === "hosp") {
    if (hospitals.length > 80) {
      out[spec.id] = { ran: false, reason: "More than 80 hospitals are listed, so each hospital was not counted." };
      return;
    }
    var one = "SELECT COUNT(*) AS cnt FROM " + spec.source + " WHERE " + hospCol + " = :hosp AND " + dateCol + " >= TO_DATE(:day, 'YYYY-MM-DD') AND " + dateCol + " < TO_DATE(:day, 'YYYY-MM-DD') + 1";
    for (var i = 0; i < hospitals.length; i++) {
      if (job.cancelled) throw disconnected();
      var counted = await q(conn, one, { hosp: hospitals[i], day: bindText(cred.day) }, 1);
      byHosp[hospitals[i]][spec.id] = Number((counted[0] && counted[0].CNT) || 0);
    }
    out[spec.id] = { ran: true, reason: "" };
    out.sql.push(spec.title + " for one hospital\n" + one);
    return;
  }
  out[spec.id] = { ran: false, reason: "No valid index leads with " + spec.dateCol + ", or with " + spec.hospCol + " and then that time. " + spec.source + " was not read. " + indexBrief(indexes[spec.table]) };
}

async function hospitalCodes(conn) {
  var listed = await q(conn, "SELECT DISTINCT TRIM(hospital_cde) AS hospital_cde FROM fc_hospital_codes WHERE TRIM(hospital_cde) IS NOT NULL ORDER BY 1", {}, 81);
  return listed.map(function (row) { return String(row.HOSPITAL_CDE || "").trim(); }).filter(function (code) { return /^[A-Z0-9]{1,10}$/.test(code); });
}

async function loadIndexes(conn) {
  var meRows = await q(conn, "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS me FROM dual", {}, 1);
  var me = meRows[0] ? meRows[0].ME : "";
  var synonyms = await q(conn, "SELECT synonym_name, table_owner, table_name, owner FROM all_synonyms WHERE synonym_name IN (" + inList(NAMES) + ") AND owner IN (:me, 'PUBLIC')", { me: me }, 20);
  var tables = await q(conn, "SELECT table_name FROM user_tables WHERE table_name IN (" + inList(NAMES) + ")", {}, 10);
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
    indexes[NAMES[i]] = await q(conn, "SELECT ic.index_name, ic.column_name, ic.column_position, i.status FROM all_ind_columns ic JOIN all_indexes i ON i.owner = ic.index_owner AND i.index_name = ic.index_name WHERE ic.table_owner = :owner AND ic.table_name = :name AND ic.column_position <= 2", { owner: item.owner, name: item.name }, 200);
  }
  return indexes;
}

function indexLead(rows, dateCol, hospCol) {
  var by = {};
  (rows || []).forEach(function (r) {
    if (r.STATUS !== "VALID") return;
    if (!by[r.INDEX_NAME]) by[r.INDEX_NAME] = [];
    by[r.INDEX_NAME].push(r);
  });
  var dateLead = false;
  var hospLead = false;
  Object.keys(by).forEach(function (name) {
    var cols = by[name].sort(function (a, b) { return Number(a.COLUMN_POSITION) - Number(b.COLUMN_POSITION); });
    var first = cols[0] && cols[0].COLUMN_NAME;
    var second = cols[1] && cols[1].COLUMN_NAME;
    if (first === dateCol) dateLead = true;
    if (first === hospCol && second === dateCol) hospLead = true;
  });
  if (hospLead && dateLead) return "both";
  if (hospLead) return "hosp";
  if (dateLead) return "date";
  return "";
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

async function q(conn, sql, binds, maxRows) {
  var result = await conn.execute(sql, binds || {}, { maxRows: maxRows || 200 });
  return result.rows || [];
}

function bindText(value) {
  return { val: value, type: oracledb.STRING, dir: oracledb.BIND_IN };
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
