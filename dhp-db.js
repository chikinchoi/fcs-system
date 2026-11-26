var oracledb;
try { oracledb = require("oracledb"); }
catch (e) { oracledb = null; }

var healthDb = require("./health-db");
var map = require("./dhp-map");
var soap = require("./dhp-soap");

if (oracledb) {
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  oracledb.autoCommit = false;
  oracledb.fetchAsString = [oracledb.CLOB];
}

var busy = false;
var current = null;
var CALL_MS = 8000;
var LOOKBACK_DAYS = 14;

function run(msg, done, res) {
  var cred = check(msg || {});
  if (cred.error) return done(400, { error: cred.error });
  if (!oracledb) {
    return done(503, { error: "The database driver is not installed. In this folder run npm install, then start the runner again." });
  }
  if (busy) return done(429, { error: "A DHP check is already running. Wait for it to finish." });
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
  var id = String(msg.id || "").trim();
  var oldResponse = String(msg.oldResponse || "");
  if (!connectString || !user || !password) return { error: "Connection string, username, and password are required." };
  if (connectString.length > 500 || /[\r\n\0'"`;]|--|\/\*/.test(connectString) || /jdbc:/i.test(connectString)) {
    return { error: "Use host:port/service, or a jdbc:oracle:thin:@//host:port/service URL." };
  }
  if (!/^[A-Za-z0-9_$#.]{1,128}$/.test(user)) return { error: "Username is letters, digits, and _ $ # ." };
  if (password.length > 128 || /[\r\n\0]/.test(password)) return { error: "Password is too long." };
  if (!/^[A-Z0-9]{1,10}$/.test(hospital)) return { error: "Hospital is 1–10 letters or digits." };
  if (start && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) return { error: "Start is YYYY-MM-DDTHH:MM." };
  if (end && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end)) return { error: "End is YYYY-MM-DDTHH:MM." };
  if ((start && !end) || (!start && end)) return { error: "Enter both a start and an end." };
  if (id && !/^\d{1,18}$/.test(id)) return { error: "The log id is not a number." };
  if (oldResponse.length > 200000) return { error: "The pasted response is too long." };
  return {
    connectString: connectString,
    user: user,
    password: password,
    hospital: hospital,
    start: start ? start.replace("T", " ") : null,
    end: end ? end.replace("T", " ") : null,
    id: id,
    oldResponse: oldResponse
  };
}

async function work(cred, job) {
  var conn;
  var out = {
    hospital: cred.hospital,
    flag: "",
    triggers: [],
    compare: null,
    warnings: [],
    sql: [],
    flows: []
  };
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
    var clock = await q(conn,
      "SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI:SS') AS now_txt, TO_CHAR(NVL(TO_DATE(:dt_from, 'YYYY-MM-DD HH24:MI'), TRUNC(SYSDATE)), 'YYYY-MM-DD HH24:MI') AS start_txt, TO_CHAR(NVL(TO_DATE(:dt_to, 'YYYY-MM-DD HH24:MI'), SYSDATE), 'YYYY-MM-DD HH24:MI') AS end_txt FROM dual",
      { dt_from: bindText(cred.start), dt_to: bindText(cred.end) }, 1);
    out.now = clock[0] ? clock[0].NOW_TXT : "";
    out.start = clock[0] ? clock[0].START_TXT : "";
    out.end = clock[0] ? clock[0].END_TXT : "";
    var hours = await q(conn,
      "SELECT ROUND((TO_DATE(:dt_to, 'YYYY-MM-DD HH24:MI') - TO_DATE(:dt_from, 'YYYY-MM-DD HH24:MI')) * 24, 2) AS hours FROM dual",
      { dt_from: bindText(out.start), dt_to: bindText(out.end) }, 1);
    if (hours[0] && Number(hours[0].HOURS) > 24 * 7) {
      out.warnings.push("The range is longer than 7 days. Narrow it before reading the log.");
      return out;
    }
    if (hours[0] && Number(hours[0].HOURS) <= 0) {
      out.warnings.push("The end is not after the start.");
      return out;
    }
    var hospitalTable = await findTable(conn, "FC_HOSPITAL_CODES");
    var logTable = await findTable(conn, "WS_TRANSACTION_LOG");
    if (!hospitalTable) {
      out.warnings.push("FC_HOSPITAL_CODES is not visible to this user.");
      return out;
    }
    noteSql(out, "SELECT TRIM(use_dhp_new_endpoint) AS flag\nFROM " + sqlName(hospitalTable) + "\nWHERE TRIM(UPPER(hospital_cde)) = :hosp\n-- :hosp = " + cred.hospital);
    var flagRows = await q(conn,
      "SELECT TRIM(use_dhp_new_endpoint) AS flag FROM " + sqlName(hospitalTable) + " WHERE TRIM(UPPER(hospital_cde)) = :hosp",
      { hosp: cred.hospital }, 5);
    out.flag = flagRows[0] && flagRows[0].FLAG != null ? String(flagRows[0].FLAG) : "";
    if (!logTable) {
      out.warnings.push("WS_TRANSACTION_LOG is not visible to this user.");
      return out;
    }
    var indexed = await hasTimeIndex(conn, logTable);
    if (!indexed) {
      out.warnings.push("WS_TRANSACTION_LOG has no index leading with REQUEST_DTM, so this page will not scan it.");
      return out;
    }
    noteSql(out, "SELECT name, SUBSTR(value, 1, 1000) AS value\nFROM FCS_CONFIG_PARAMETER\nWHERE name IN ('pasDhpFindAppointmentUrl', 'pasDhpFindSpecialtyUrl', 'pasDhpFindOpasUnitUrl')\n-- the host is removed before the path is shown");
    var paths = await endpointPaths(conn);
    noteSql(out, "SELECT id, ws_key, response_code,\n       TO_CHAR(request_dtm, 'YYYY-MM-DD HH24:MI:SS.FF6') AS request_dtm,\n       SUBSTR(request_params, 1, 4000) AS request_params\nFROM (\n  SELECT id, ws_key, response_code, request_dtm, request_params\n  FROM " + sqlName(logTable) + "\n  WHERE request_dtm >= TO_DATE(:dt_from, 'YYYY-MM-DD HH24:MI')\n    AND request_dtm < TO_DATE(:dt_to, 'YYYY-MM-DD HH24:MI') + (1/1440)\n  ORDER BY request_dtm DESC, id DESC\n)\nWHERE ROWNUM <= 800\n-- the end minute is included\n-- repeated backward through the index until the range is covered, or 30 seconds\n-- :dt_from = " + out.start + "\n-- :dt_to = " + out.end);
    var listed = await listTriggers(conn, logTable, cred.hospital, out.start, out.end, paths);
    out.triggers = listed.triggers;
    out.flows = flowSummary(listed.stats, paths);
    out.coverage = coverageNote(listed, out.start, out.end);
    out.verdict = verdict(out.flag, out.flows, listed);
    if (listed.note) out.warnings.push(listed.note);
    if (cred.id) {
      out.selected = cred.id;
      try {
        out.compare = await compareOne(conn, logTable, cred.hospital, cred.id, cred.oldResponse, out);
      } catch (err) {
        if (!timedOut(err)) throw err;
        out.warnings.push("That comparison did not finish within 8 seconds. The call list is still shown. Nothing was written.");
      }
    }
    return out;
  } finally {
    if (job) job.conn = null;
    if (conn) {
      try { await conn.close(); } catch (e) { /* closed after a cancelled read */ }
    }
  }
}

var FLOWS = [
  { source: "SOPD_ATTENDANCE_API", label: "SOPD attendance", entry: "doCallSOPDAttn" },
  { source: "SOPD_PATIENT_INFO_API", label: "Patient info", entry: "doCallPatientInfo" },
  { source: "SOPD_PATIENT_INFO_API_MEDD", label: "MEDD patient", entry: "doCallPatientInfoForMedd" },
  { source: "SOPD_PATIENT_INFO_API_MAM", label: "MAM patient", entry: "doCallPatientInfoMAM" },
  { source: "doCallSpec_findSpecialty", label: "Specialty", entry: "doCallSpec" },
  { source: "doCallSubSpec_findOpasUnit", label: "OPAS unit", entry: "doCallSubSpec" },
  { source: "doCallEis_findOpasUnit", label: "EIS", entry: "doCallEis" }
];

function noteSql(out, text) {
  if (out && out.sql) out.sql.push(text);
}

function okCode(code) {
  var number = Number(code);
  return number === 200 || number === 0;
}

function textOf(value) {
  return value == null ? "" : String(value).trim();
}

function flowSummary(stats, paths) {
  var seen = stats || {};
  var known = {};
  var rows = FLOWS.map(function (item) {
    known[item.source] = true;
    var row = seen[item.source] || { n: 0, bad: 0, last: "" };
    return {
      source: item.source,
      label: item.label,
      entry: item.entry,
      endpoint: endpointFor(item.source, paths || {}),
      n: row.n,
      bad: row.bad,
      last: row.last
    };
  });
  Object.keys(seen).forEach(function (source) {
    if (known[source]) return;
    var row = seen[source];
    rows.push({
      source: source,
      label: source,
      entry: "Not in the seven known entries",
      endpoint: endpointFor(source, paths || {}),
      n: row.n,
      bad: row.bad,
      last: row.last
    });
  });
  return rows;
}

function verdict(flag, flows, listed) {
  var scanned = listed && listed.scanned || 0;
  if (String(flag || "").toUpperCase() !== "Y") return "USE_DHP_NEW_ENDPOINT is not Y, so HHH is not confirmed on the new endpoint.";
  var rows = flows || [];
  var seen = rows.filter(function (row) { return row.n > 0; });
  var bad = rows.reduce(function (sum, row) { return sum + (row.bad || 0); }, 0);
  if (!seen.length) {
    if (listed && listed.complete) return "The flag is Y. Every log row in this range was read (" + scanned + "), and none is a new-endpoint call for this hospital.";
    return "The flag is Y. The rows read so far have no new-endpoint call for this hospital. " + coverageNote(listed, "", "");
  }
  var text = "The flag is Y. " + seen.map(function (row) {
    return row.label + " " + row.n + (row.bad ? " (" + row.bad + " failed)" : "");
  }).join(", ") + ".";
  if (bad) text += " A failed call means the new endpoint did not answer. That is a health problem before any field difference.";
  else text += " Every seen call returned a success code.";
  var missing = rows.filter(function (row) { return !row.n; }).map(function (row) { return row.label; });
  if (missing.length) text += " Not in the rows read: " + missing.join(", ") + ".";
  if (listed && !listed.complete) text += " The count does not cover the whole range.";
  text += " Compare calls the old SOAP endpoint for one row. Handled means the mapping already stores the same result. Differs means it does not.";
  return text;
}

function coverageNote(listed, start) {
  var scanned = listed && listed.scanned || 0;
  var oldest = stampText(listed && listed.oldest);
  if (listed && listed.complete) return "Counted every log row in this range (" + scanned + ").";
  var text = "Counted the newest " + scanned + " log rows, back to " + (oldest || "the start of the read") + ".";
  if (start) text += " This range starts at " + start + ".";
  text += " Calls before that time are not in the table, so Not seen does not mean the path never ran.";
  return text;
}

async function listTriggers(conn, table, hospital, start, end, paths) {
  var list = [];
  var stats = {};
  var scanned = 0;
  var cursor = null;
  var oldest = "";
  var complete = false;
  var deadline = Date.now() + 30000;
  var note = "";
  while (scanned < 200000 && Date.now() < deadline) {
    var rows;
    try {
      rows = await recentPage(conn, table, start, end, cursor);
    } catch (err) {
      if (!timedOut(err)) throw err;
      note = "A log read stopped at 8 seconds after " + scanned + " rows. Nothing was written.";
      break;
    }
    if (!rows.length) { complete = true; break; }
    scanned += rows.length;
    rows.forEach(function (row) {
      var facts = factsFromParams(row.REQUEST_PARAMS);
      if (facts.hospital.toUpperCase() !== hospital) return;
      if (!facts.source) return;
      if (!stats[facts.source]) stats[facts.source] = { n: 0, bad: 0, last: "" };
      stats[facts.source].n += 1;
      if (!okCode(row.RESPONSE_CODE)) stats[facts.source].bad += 1;
      if (!stats[facts.source].last) stats[facts.source].last = stampText(row.REQUEST_DTM);
      if (list.length >= 20) return;
      list.push({
        id: String(row.ID),
        at: stampText(row.REQUEST_DTM),
        wsKey: row.WS_KEY || "",
        responseCode: row.RESPONSE_CODE == null ? "" : String(row.RESPONSE_CODE),
        source: facts.source,
        endpoint: endpointFor(facts.source, paths),
        caseNo: facts.caseNo,
        apptSeq: facts.apptSeq,
        specialty: facts.specialty
      });
    });
    var last = rows[rows.length - 1];
    oldest = last.REQUEST_DTM || oldest;
    if (rows.length < 800) { complete = true; break; }
    cursor = { at: last.REQUEST_DTM, id: last.ID };
  }
  return { triggers: list, note: note, stats: stats, scanned: scanned, oldest: oldest, complete: complete };
}

async function compareOne(conn, table, hospital, id, oldResponse, out) {
  noteSql(out, "SELECT id, ws_key, request_dtm, request_msg, response_msg\nFROM " + sqlName(table) + "\nWHERE id = :id");
  var rows = await q(conn,
    "SELECT id, ws_key, TO_CHAR(request_dtm, 'YYYY-MM-DD HH24:MI:SS.FF6') AS request_dtm, request_msg, response_msg FROM " + sqlName(table) + " WHERE id = :id",
    { id: Number(id) }, 1);
  if (!rows.length) return { error: "That log row was not found." };
  var requestJson = map.parseJson(rows[0].REQUEST_MSG) || {};
  var facts = map.requestFacts(rows[0].REQUEST_MSG);
  if (!facts.hospital) facts = factsFromParams(rows[0].REQUEST_MSG);
  if (!facts.source) facts.source = textOf(requestJson._logSource);
  if (facts.hospital && facts.hospital.toUpperCase() !== hospital) {
    return { error: "That log row is for another hospital." };
  }
  var pasted = String(oldResponse || "").trim();
  var oldBody = pasted;
  var note = "";
  var oldRequest = "";
  if (pasted) {
    note = "The old response is the text pasted on this page. It is not stored.";
  } else {
    var called = await callMappedSoap(conn, rows[0].WS_KEY, facts.source, requestJson, out);
    oldBody = called.body;
    note = called.note;
    if (called.params) oldRequest = JSON.stringify(called.params, null, 2);
  }
  var compared = map.compareFull(facts.source, oldBody, clip(rows[0].RESPONSE_MSG));
  return {
    id: String(rows[0].ID),
    at: stampText(rows[0].REQUEST_DTM),
    source: facts.source || compared.source,
    caseNo: facts.caseNo,
    apptSeq: facts.apptSeq,
    note: note,
    counts: compared.counts,
    groups: compared.groups,
    called: !pasted,
    payloads: {
      newRequest: showBody(rows[0].REQUEST_MSG),
      newResponse: showBody(rows[0].RESPONSE_MSG),
      oldRequest: oldRequest,
      oldResponse: showBody(oldBody)
    }
  };
}

async function callMappedSoap(conn, wsKey, source, requestJson, out) {
  var mapTable = await findTable(conn, "WS_KEY_MAPPING");
  if (!mapTable) return { body: "", note: "WS_KEY_MAPPING is not visible, so the old endpoint was not called." };
  noteSql(out, "SELECT target_namespace, target_namespace_prefix, web_method, endpoint_url, username, password\nFROM " + sqlName(mapTable) + "\nWHERE ws_key = :ws_key\n-- username and password are used for the SOAP call and are not shown");
  var mapping = await q(conn,
    "SELECT target_namespace, target_namespace_prefix, web_method, endpoint_url, username, password FROM " + sqlName(mapTable) + " WHERE ws_key = :ws_key",
    { ws_key: String(wsKey || "") }, 1);
  if (!mapping.length) return { body: "", note: "No WS_KEY_MAPPING row for this call, so the old endpoint was not called." };
  try {
    var result = await soap.callOld(mapping[0], source, requestJson);
    var note = "Compare called the old SOAP path " + result.path + ". SOPD attendance is sent with withPatient N, which is what the old SOAP method sends. The new attendance call sends withPatient Y. The SOAP user and password stay on the server.";
    if (result.status && result.status >= 400) note += " The old endpoint returned HTTP " + result.status + ".";
    return { body: result.body, note: note, params: result.params };
  } catch (err) {
    return { body: "", note: String(err && err.message || "The old endpoint did not answer.") };
  }
}

function clip(value) {
  var text = value == null ? "" : String(value);
  return text.length > 200000 ? text.slice(0, 200000) : text;
}

function showBody(value) {
  var raw = clip(value);
  var parsed = map.parseJson(raw);
  if (parsed) {
    try { return JSON.stringify(parsed, null, 2); }
    catch (e) { /* show the text below */ }
  }
  var text = String(raw || "");
  if (text.trim().charAt(0) === "<") return formatXml(text);
  var undone = map.undoCp850(text);
  if (undone && undone !== text && undone.trim().charAt(0) === "<") return formatXml(undone);
  return undone || text;
}

function formatXml(value) {
  var flat = String(value || "").replace(/\r\n/g, "\n").trim().replace(/>\s+</g, "><");
  if (!flat) return "";
  var pad = 0;
  var lines = [];
  var re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]+>|[^<]+/g;
  var match;
  while ((match = re.exec(flat))) {
    var token = match[0];
    if (token.charAt(0) !== "<") {
      var body = token.trim();
      if (body) lines.push(indent(pad) + body);
      continue;
    }
    var closing = token.indexOf("</") === 0;
    if (closing) pad = Math.max(pad - 1, 0);
    lines.push(indent(pad) + token);
    var leaf = closing || /\/>$/.test(token) || token.indexOf("<?") === 0 || token.indexOf("<!") === 0;
    if (!leaf) pad += 1;
  }
  return lines.join("\n");
}

function indent(n) {
  var spaces = "";
  for (var i = 0; i < n; i++) spaces += "  ";
  return spaces;
}

function matchKey(facts) {
  if (/^\d+$/.test(facts.apptSeq) && facts.apptSeq !== "0") return facts.apptSeq;
  if (facts.caseNo && facts.caseNo.length >= 4 && /^[A-Za-z0-9]+$/.test(facts.caseNo)) return facts.caseNo;
  if (/^\d+$/.test(facts.patientKey) && facts.patientKey !== "0") return facts.patientKey;
  if (facts.specialty && /^[A-Za-z0-9]{2,10}$/.test(facts.specialty)) return facts.specialty;
  return "";
}

async function recentPage(conn, table, start, end, cursor) {
  var name = sqlName(table);
  var cols = "id, ws_key, response_code, TO_CHAR(request_dtm, 'YYYY-MM-DD HH24:MI:SS.FF6') AS request_dtm, SUBSTR(request_params, 1, 4000) AS request_params";
  if (!cursor) {
    return q(conn,
      "SELECT " + cols + " FROM (SELECT id, ws_key, response_code, request_dtm, request_params FROM " + name + " WHERE request_dtm >= TO_DATE(:dt_from, 'YYYY-MM-DD HH24:MI') AND request_dtm < TO_DATE(:dt_to, 'YYYY-MM-DD HH24:MI') + (1/1440) ORDER BY request_dtm DESC, id DESC) WHERE ROWNUM <= 800",
      { dt_from: bindText(start), dt_to: bindText(end) }, 800);
  }
  return q(conn,
    "SELECT " + cols + " FROM (SELECT id, ws_key, response_code, request_dtm, request_params FROM " + name + " WHERE request_dtm >= TO_DATE(:dt_from, 'YYYY-MM-DD HH24:MI') AND (request_dtm < TO_TIMESTAMP(:cursor_at, 'YYYY-MM-DD HH24:MI:SS.FF6') OR (request_dtm = TO_TIMESTAMP(:cursor_at, 'YYYY-MM-DD HH24:MI:SS.FF6') AND id < :before_id)) ORDER BY request_dtm DESC, id DESC) WHERE ROWNUM <= 800",
    { dt_from: bindText(start), cursor_at: bindText(cursor.at), before_id: Number(cursor.id) }, 800);
}

async function findSoap(conn, table, hospital, key, callAt) {
  var scanned = 0;
  var cursor = { at: callAt, id: "999999999999999" };
  var oldest = callAt;
  var name = sqlName(table);
  while (scanned < 4800) {
    var rows = await q(conn,
      "SELECT id, TO_CHAR(request_dtm, 'YYYY-MM-DD HH24:MI:SS.FF6') AS request_dtm, SUBSTR(request_params, 1, 1500) AS request_params FROM (SELECT id, request_dtm, request_params FROM " + name + " WHERE request_dtm >= TO_TIMESTAMP(:call_at, 'YYYY-MM-DD HH24:MI:SS.FF6') - " + LOOKBACK_DAYS + " AND (request_dtm < TO_TIMESTAMP(:cursor_at, 'YYYY-MM-DD HH24:MI:SS.FF6') OR (request_dtm = TO_TIMESTAMP(:cursor_at, 'YYYY-MM-DD HH24:MI:SS.FF6') AND id < :before_id)) ORDER BY request_dtm DESC, id DESC) WHERE ROWNUM <= 800",
      { call_at: bindText(callAt), cursor_at: bindText(cursor.at), before_id: Number(cursor.id) }, 800);
    if (!rows.length) break;
    scanned += rows.length;
    for (var i = 0; i < rows.length; i++) {
      if (soapMatch(rows[i].REQUEST_PARAMS, hospital, key)) return { row: rows[i], note: "" };
    }
    oldest = rows[rows.length - 1].REQUEST_DTM || oldest;
    if (rows.length < 800) break;
    cursor = { at: rows[rows.length - 1].REQUEST_DTM, id: rows[rows.length - 1].ID };
  }
  if (scanned >= 4800) {
    return { row: null, note: "Looked through the newest 4800 log rows before this call, back to " + stampText(oldest) + ". No SOAP row for " + key + " was in that set." };
  }
  return { row: null, note: "No SOAP log for " + key + " was found in the " + LOOKBACK_DAYS + " days before this call." };
}

function factsFromParams(params) {
  var empty = { source: "", hospital: "", caseNo: "", apptSeq: "", specialty: "", patientKey: "" };
  var text = String(params || "");
  var groups = groupedParts(text);
  if (groups.length < 2) {
    empty.source = knownSource(text);
    return empty;
  }
  var keys = splitDepth0(groups[0]);
  var values = splitDepth0(groups[1]);
  function val(name) {
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].trim() === name) return String(values[i] == null ? "" : values[i]).trim();
    }
    return "";
  }
  return {
    source: val("_logSource") || knownSource(text),
    hospital: val("hospitalCode") || val("hospital"),
    caseNo: val("caseNo"),
    apptSeq: val("apptSeq"),
    specialty: val("specialty"),
    patientKey: val("patientKey")
  };
}

function groupedParts(text) {
  var groups = [];
  var depth = 0;
  var start = -1;
  var quote = "";
  var s = String(text || "");
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === "\"") { quote = c; continue; }
    if (c === "[" || c === "{") {
      if (depth === 0 && c === "[") start = i + 1;
      depth++;
      continue;
    }
    if (c === "]" || c === "}") {
      if (depth > 0) depth--;
      if (depth === 0 && c === "]" && start >= 0) {
        groups.push(s.slice(start, i));
        start = -1;
        if (groups.length === 2) break;
      }
    }
  }
  return groups;
}

function splitDepth0(text) {
  var parts = [];
  var buf = "";
  var depth = 0;
  var quote = "";
  var s = String(text || "");
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (quote) {
      buf += c;
      if (c === "\\") {
        if (i + 1 < s.length) buf += s.charAt(++i);
      } else if (c === quote) quote = "";
      continue;
    }
    if (c === "\"") { quote = c; buf += c; continue; }
    if (c === "[" || c === "{") { depth++; buf += c; continue; }
    if (c === "]" || c === "}") { if (depth > 0) depth--; buf += c; continue; }
    if (c === "," && depth === 0) { parts.push(buf.trim()); buf = ""; continue; }
    buf += c;
  }
  if (buf.length || parts.length) parts.push(buf.trim());
  return parts;
}

var KNOWN_SOURCES = [
  "SOPD_PATIENT_INFO_API_MEDD",
  "SOPD_PATIENT_INFO_API_MAM",
  "SOPD_PATIENT_INFO_API",
  "SOPD_ATTENDANCE_API",
  "doCallSpec_findSpecialty",
  "doCallSubSpec_findOpasUnit",
  "doCallEis_findOpasUnit"
];

function knownSource(text) {
  for (var i = 0; i < KNOWN_SOURCES.length; i++) {
    if (text.indexOf(KNOWN_SOURCES[i]) >= 0) return KNOWN_SOURCES[i];
  }
  return "";
}

function soapMatch(params, hospital, key) {
  var text = String(params || "");
  if (text.indexOf("_logSource") >= 0) return false;
  return hasToken(text, hospital) && hasToken(text, key);
}

function hasToken(text, token) {
  var safe = String(token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^A-Za-z0-9])" + safe + "([^A-Za-z0-9]|$)").test(text);
}

function stampText(value) {
  return String(value || "").slice(0, 19);
}

async function endpointPaths(conn) {
  var table = await findTable(conn, "FCS_CONFIG_PARAMETER");
  var paths = {};
  if (!table) return paths;
  var rows = await q(conn,
    "SELECT name, SUBSTR(value, 1, 1000) AS value FROM " + sqlName(table) + " WHERE name IN ('pasDhpFindAppointmentUrl', 'pasDhpFindSpecialtyUrl', 'pasDhpFindOpasUnitUrl')",
    {}, 10);
  rows.forEach(function (row) { paths[row.NAME] = pathOnly(row.VALUE); });
  return paths;
}

function endpointFor(source, paths) {
  var text = String(source || "");
  var name = "pasDhpFindAppointmentUrl";
  if (/findSpecialty|doCallSpec/i.test(text) && !/findOpasUnit|doCallSubSpec|doCallEis/i.test(text)) name = "pasDhpFindSpecialtyUrl";
  else if (/findOpasUnit|doCallSubSpec|doCallEis/i.test(text)) name = "pasDhpFindOpasUnitUrl";
  return paths[name] || "";
}

function pathOnly(value) {
  var text = String(value || "").trim();
  if (!text || text.indexOf("/") < 0) return "";
  var hosted = text.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)(\?[^#]*)?/i);
  if (hosted) return (hosted[1] || "/") + (hosted[2] || "");
  var slash = text.indexOf("/");
  return text.slice(slash).split("#")[0];
}

async function findTable(conn, name) {
  var own = await q(conn, "SELECT table_name FROM user_tables WHERE table_name = :name", { name: name }, 1);
  if (own.length) {
    var me = await q(conn, "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS me FROM dual", {}, 1);
    return { owner: me[0].ME, name: own[0].TABLE_NAME };
  }
  var syn = await q(conn,
    "SELECT table_owner, table_name FROM all_synonyms WHERE synonym_name = :name AND owner IN (SYS_CONTEXT('USERENV','CURRENT_SCHEMA'), 'PUBLIC') ORDER BY CASE owner WHEN 'PUBLIC' THEN 1 ELSE 0 END",
    { name: name }, 5);
  if (!syn.length) return null;
  return { owner: syn[0].TABLE_OWNER, name: syn[0].TABLE_NAME };
}

async function hasTimeIndex(conn, table) {
  var rows = await q(conn,
    "SELECT ic.column_name, i.status FROM all_ind_columns ic JOIN all_indexes i ON i.owner = ic.index_owner AND i.index_name = ic.index_name WHERE ic.table_owner = :owner AND ic.table_name = :name AND ic.column_position = 1",
    { owner: table.owner, name: table.name }, 100);
  return rows.some(function (row) {
    return row.STATUS === "VALID" && row.COLUMN_NAME === "REQUEST_DTM";
  });
}

function sqlName(table) {
  if (!/^[A-Z0-9_$#]+$/.test(table.owner) || !/^[A-Z0-9_$#]+$/.test(table.name)) {
    throw new Error("Unexpected table name.");
  }
  return table.owner + "." + table.name;
}

function disconnected() {
  var err = new Error("Disconnected. The database session was closed.");
  err.disconnected = true;
  return err;
}

async function q(conn, sql, binds, maxRows) {
  var result = await conn.execute(sql, binds || {}, { maxRows: maxRows || 50 });
  return result.rows || [];
}

function bindText(value) {
  return { val: value, type: oracledb.STRING, dir: oracledb.BIND_IN };
}

function safeMessage(err) {
  if (err && err.disconnected) return "Disconnected. The database session was closed.";
  var num = err && err.errorNum;
  if (num === 1013) return "Disconnected. The database session was closed.";
  if (num === 1017) return "The database refused this username or password.";
  if (num === 12154 || num === 12514 || num === 12541 || num === 12545) return "The database address could not be reached.";
  var text = String(err && err.message || "The database check failed.");
  if (timedOut(err)) return "A read did not finish within 8 seconds. The check stopped. Nothing was written.";
  text = text.replace(/password[=:]\s*\S+/ig, "password");
  if (text.length > 280) text = text.slice(0, 280);
  return text;
}

function timedOut(err) {
  var text = String(err && (err.message || err.code) || "");
  return err.code === "NJS-510" || /call timeout|NJS-510|DPI-1067/i.test(text);
}

module.exports = { run: run, disconnect: disconnect };
