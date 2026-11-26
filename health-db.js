var oracledb;
try { oracledb = require("oracledb"); }
catch (e) { oracledb = null; }

if (oracledb) {
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  oracledb.autoCommit = false;
}

var busy = false;
var current = null;
var CALL_MS = 8000;

var NAMES = [
  "MED_PROFILE_CHARGE_HDR_LOG",
  "MED_PROFILE_CHARGE_HDR",
  "MED_PROFILE_CHARGE_DETAIL",
  "FC_DRUG_CHARGING",
  "FC_CASE_SERVICES",
  "FC_SFI_CHARGING",
  "FC_MED_DETAIL_EXCEPTION",
  "FC_RECEIPTS"
];

function run(msg, done, res) {
  var cred = check(msg || {});
  if (cred.error) return done(400, { error: cred.error });
  if (!oracledb) {
    return done(503, { error: "The database driver is not installed. In this folder run npm install, then start the runner again." });
  }
  if (busy) return done(429, { error: "A health check is already running. Wait for it to finish." });
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
    conn.breakExecution().catch(function () { /* the read will fail and the session is closed */ });
  }
}

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
  var name = service[3];
  var again = name.indexOf(service[1]);
  if (again > 0) name = name.slice(0, again);
  return service[1] + ":" + service[2] + "/" + name;
}

function check(msg) {
  var connectString = easyConnect(msg.connectString);
  var user = String(msg.user || "").trim();
  var password = String(msg.password || "");
  var hospital = String(msg.hospital || "").trim().toUpperCase();
  var day = String(msg.day || "").trim();
  if (!connectString || !user || !password) return { error: "Connection string, username, and password are required." };
  if (connectString.length > 500 || /[\r\n\0'"`;]|--|\/\*/.test(connectString) || /jdbc:/i.test(connectString)) {
    return { error: "Use host:port/service, or a jdbc:oracle:thin:@//host:port/service URL." };
  }
  if (!/^[A-Za-z0-9_$#.]{1,128}$/.test(user)) return { error: "Username is letters, digits, and _ $ # ." };
  if (password.length > 128 || /[\r\n\0]/.test(password)) return { error: "Password is too long." };
  if (hospital && !/^[A-Z0-9]{1,10}$/.test(hospital)) return { error: "Hospital is 1–10 letters or digits." };
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Day is YYYY-MM-DD." };
  var start = String(msg.start || "").trim();
  var end = String(msg.end || "").trim();
  if (start && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) return { error: "Start is YYYY-MM-DDTHH:MM." };
  if (end && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end)) return { error: "End is YYYY-MM-DDTHH:MM." };
  if ((start && !end) || (!start && end)) return { error: "Enter both a start and an end." };
  var tab = msg.tab === "charge" || msg.tab === "case" || msg.tab === "sfi" || msg.tab === "receipts" ? msg.tab : "receipts";
  var page = parseInt(msg.page, 10);
  if (!isFinite(page) || page < 0) page = 0;
  if (page > 200) page = 200;
  return {
    connectString: connectString,
    user: user,
    password: password,
    hospital: hospital,
    day: day || null,
    start: start ? start.replace("T", " ") : null,
    end: end ? end.replace("T", " ") : null,
    tab: tab,
    page: page
  };
}

async function work(cred, job) {
  var conn;
  var out = {
    hospital: cred.hospital,
    day: cred.day,
    now: "",
    moe: [],
    seats: { ran: false, reason: "", rows: [] },
    flow: [],
    receiptTypes: skipped("Saved receipts by type", "Enter a hospital before a day count."),
    moeHours: skipped("MOE headers received by FCS", "Enter a hospital before a day count."),
    headerHours: skipped("Med header", "Enter a hospital before a day count."),
    detailHours: skipped("Med detail", "Enter a hospital before a day count."),
    recentHeader: skipped("med_profile_charge_hdr", "Enter a hospital before a count."),
    recentDetail: skipped("med_profile_charge_detail", "Enter a hospital before a count."),
    chargeHours: skipped("Drug charging", "Enter a hospital before a day count."),
    caseHours: skipped("Case service", "Enter a hospital before a day count."),
    sfiHours: skipped("SFI charging written", "Enter a hospital before a day count."),
    exceptionHours: skipped("Detail exceptions", "Enter a hospital before a day count."),
    receiptHours: skipped("Saved receipts", "Enter a hospital before a day count."),
    cards: {},
    latestCreate: [],
    receiptLatest: { ran: false, reason: "", rows: [], sql: "" },
    volume: [],
    list: { tab: "receipts", page: 0, pageSize: 100, total: 0, columns: [], rows: [] },
    sql: [],
    warnings: []
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
    if (job.cancelled) throw disconnected();
    var clock = await q(conn, "SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI:SS') AS now_txt, TO_CHAR(NVL(TO_DATE(:day, 'YYYY-MM-DD'), TRUNC(SYSDATE)), 'YYYY-MM-DD') AS day_txt FROM dual", {
      day: bindText(cred.day)
    }, 1);
    out.now = clock[0] ? clock[0].NOW_TXT : "";
    out.day = clock[0] ? clock[0].DAY_TXT : cred.day;
    await readDashboard(conn, cred, out, job);
    return out;
  } catch (err) {
    if (job.cancelled) throw err;
    if (out.moeRan || (out.cards && Object.keys(out.cards).some(function (id) { return out.cards[id].ran; }))) {
      out.warnings.push(safeMessage(err));
      out.stopped = true;
      return out;
    }
    throw err;
  } finally {
    if (job) job.conn = null;
    if (conn) {
      try { await conn.close(); } catch (e) { /* closed after a cancelled read */ }
    }
  }
}

function disconnected() {
  var err = new Error("Disconnected. The database session was closed.");
  err.disconnected = true;
  return err;
}

async function readDashboard(conn, cred, out, job) {
  var bounds = await q(conn,
    "SELECT TO_CHAR(NVL(TO_DATE(:dt_from, 'YYYY-MM-DD HH24:MI'), TRUNC(SYSDATE)), 'YYYY-MM-DD HH24:MI') AS start_txt, TO_CHAR(NVL(TO_DATE(:dt_to, 'YYYY-MM-DD HH24:MI'), SYSDATE), 'YYYY-MM-DD HH24:MI') AS end_txt, ROUND((NVL(TO_DATE(:dt_to, 'YYYY-MM-DD HH24:MI'), SYSDATE) - NVL(TO_DATE(:dt_from, 'YYYY-MM-DD HH24:MI'), TRUNC(SYSDATE))) * 24, 2) AS hours FROM dual",
    { dt_from: bindText(cred.start), dt_to: bindText(cred.end) }, 1);
  var span = bounds[0] ? Number(bounds[0].HOURS) : 0;
  if (!(span > 0) || span > 24 * 31) throw new Error("The range must be longer than a minute and no more than 31 days.");
  out.start = bounds[0].START_TXT;
  out.end = bounds[0].END_TXT;
  out.bucket = span > 48 ? "day" : "hour";
  var indexes = await loadIndexes(conn);
  var facts = [
    fact("charge", "Drug charging", "FC_DRUG_CHARGING", "fc_drug_charging", "FC_UPD_DTM", "HOSPITAL_CDE",
      "COUNT(*) AS cnt, COUNT(DISTINCT moe_order_no) AS extra",
      "hospital_cde, case_no, moe_order_no, seq_no, charge_amt, status_cde, fc_user, fc_ws, TO_CHAR(fc_upd_dtm, 'YYYY-MM-DD HH24:MI:SS') AS at_time"),
    fact("case", "Case services", "FC_CASE_SERVICES", "fc_case_services", "UPD_DTM", "HOSPITAL_CDE",
      "COUNT(*) AS cnt",
      "hospital_cde, case_no, service_cde, item_cnt, charge_amt, status_cde, TO_CHAR(upd_dtm, 'YYYY-MM-DD HH24:MI:SS') AS at_time"),
    fact("sfi", "SFI charging", "FC_SFI_CHARGING", "fc_sfi_charging", "UPD_DTM", "HOSPITAL_CDE",
      "COUNT(*) AS cnt",
      "hospital_cde, case_no, sfi_inv_no, charge_amt, status_cde, TO_CHAR(upd_dtm, 'YYYY-MM-DD HH24:MI:SS') AS at_time"),
    fact("receipts", "Receipts", "FC_RECEIPTS", "fc_receipts", "RECEIPT_DTM", "HOSPITAL_CDE",
      "COUNT(*) AS cnt, NVL(SUM(receipt_amt), 0) AS extra",
      "hospital_cde, receipt_no, receipt_amt, payment_means, receipt_type, case_no, status_cde, cr_dr, fc_user, fc_ws, TO_CHAR(receipt_dtm, 'YYYY-MM-DD HH24:MI:SS') AS at_time")
  ];
  out.cards = {};
  out.volume = [];
  out.sql = [];
  var active = null;
  var receiptQuery = null;
  for (var i = 0; i < facts.length; i++) {
    if (job && job.cancelled) throw disconnected();
    var item = facts[i];
    var gate = cred.hospital ? usable(indexes[item.table], item.dateCol, item.hospCol) : usable(indexes[item.table], item.dateCol, "");
    if (!gate) {
      out.cards[item.id] = { id: item.id, title: item.title, ran: false, reason: "No valid index leads with " + item.dateCol + (cred.hospital ? ", or with " + item.hospCol + " and then that time." : ". Choose one hospital, or the time column must lead the index."), count: null, extra: null };
      continue;
    }
    var where = item.dateCol.toLowerCase() + " >= TO_DATE(:dt_from, 'YYYY-MM-DD HH24:MI') AND " + item.dateCol.toLowerCase() + " < TO_DATE(:dt_to, 'YYYY-MM-DD HH24:MI')";
    if (item.id === "receipts") where += " AND status_cde = 'IS'";
    if (cred.hospital) where += " AND " + item.hospCol.toLowerCase() + " = :hosp";
    var binds = { dt_from: bindText(out.start), dt_to: bindText(out.end) };
    if (cred.hospital) binds.hosp = cred.hospital;
    var countSql = "SELECT " + item.measure + " FROM " + item.source + " WHERE " + where;
    var counted = await q(conn, countSql, binds, 1);
    var row = counted[0] || {};
    out.cards[item.id] = { id: item.id, title: item.title, ran: true, reason: "", count: Number(row.CNT || 0), extra: row.EXTRA == null ? null : Number(row.EXTRA), source: item.source };
    out.sql.push(item.title + "\n" + countSql);
    var mask = out.bucket === "day" ? "YYYY-MM-DD" : "YYYY-MM-DD HH24";
    var hourSql = "SELECT TO_CHAR(" + item.dateCol.toLowerCase() + ", '" + mask + "') AS bucket, COUNT(*) AS cnt FROM " + item.source + " WHERE " + where + " GROUP BY TO_CHAR(" + item.dateCol.toLowerCase() + ", '" + mask + "')";
    var hours = await q(conn, hourSql, binds, 800);
    out.volume.push({ id: item.id, title: item.title, rows: hours.map(function (r) { return { bucket: String(r.BUCKET), count: Number(r.CNT || 0) }; }) });
    if (item.id === "receipts") {
      var kept = {};
      Object.keys(binds).forEach(function (key) { kept[key] = binds[key]; });
      receiptQuery = { where: where, binds: kept };
    }
    if (item.id === cred.tab) active = { item: item, where: where, binds: binds };
  }
  out.list = { tab: cred.tab, page: cred.page, pageSize: 100, total: out.cards[cred.tab] && out.cards[cred.tab].count || 0, columns: [], rows: [] };
  if (active && out.cards[cred.tab] && out.cards[cred.tab].ran) {
    var listSql = "SELECT " + active.item.list + " FROM " + active.item.source + " WHERE " + active.where + " ORDER BY " + active.item.dateCol.toLowerCase() + " DESC OFFSET :skip_n ROWS FETCH NEXT 100 ROWS ONLY";
    var listBinds = {};
    Object.keys(active.binds).forEach(function (key) { listBinds[key] = active.binds[key]; });
    listBinds.skip_n = { val: cred.page * 100, type: oracledb.NUMBER, dir: oracledb.BIND_IN };
    var listed = await q(conn, listSql, listBinds, 100);
    out.sql.push(active.item.title + " page\n" + listSql);
    if (listed.length) {
      out.list.columns = Object.keys(listed[0]);
      out.list.rows = listed.map(function (record) {
        var copy = {};
        out.list.columns.forEach(function (key) { copy[key] = record[key] == null ? "" : String(record[key]); });
        return copy;
      });
    }
  }
  await readReceiptLatest(conn, out, receiptQuery, job);
}

async function readReceiptLatest(conn, out, receiptQuery, job) {
  if (job && job.cancelled) throw disconnected();
  if (!receiptQuery) {
    var card = out.cards.receipts || {};
    out.receiptLatest = { ran: false, reason: card.reason || "Receipts were not read.", rows: [], sql: "" };
    return;
  }
  var sql = "SELECT receipt_type, " +
    "MAX(receipt_no) KEEP (DENSE_RANK LAST ORDER BY receipt_dtm, receipt_no) AS receipt_no, " +
    "MAX(hospital_cde) KEEP (DENSE_RANK LAST ORDER BY receipt_dtm, receipt_no) AS hospital_cde, " +
    "MAX(case_no) KEEP (DENSE_RANK LAST ORDER BY receipt_dtm, receipt_no) AS case_no, " +
    "MAX(receipt_amt) KEEP (DENSE_RANK LAST ORDER BY receipt_dtm, receipt_no) AS receipt_amt, " +
    "MAX(payment_means) KEEP (DENSE_RANK LAST ORDER BY receipt_dtm, receipt_no) AS payment_means, " +
    "MAX(status_cde) KEEP (DENSE_RANK LAST ORDER BY receipt_dtm, receipt_no) AS status_cde, " +
    "MAX(cr_dr) KEEP (DENSE_RANK LAST ORDER BY receipt_dtm, receipt_no) AS cr_dr, " +
    "MAX(fc_user) KEEP (DENSE_RANK LAST ORDER BY receipt_dtm, receipt_no) AS fc_user, " +
    "MAX(fc_ws) KEEP (DENSE_RANK LAST ORDER BY receipt_dtm, receipt_no) AS fc_ws, " +
    "TO_CHAR(MAX(receipt_dtm), 'YYYY-MM-DD HH24:MI:SS') AS at_time, " +
    "COUNT(*) AS cnt " +
    "FROM fc_receipts WHERE " + receiptQuery.where + " AND cr_dr = 'D' GROUP BY receipt_type ORDER BY receipt_type";
  try {
    var listed = await q(conn, sql, receiptQuery.binds, 80);
    var known = ["DR", "DD", "DF", "DV", "DH"];
    var rows = listed.map(function (record) {
      return {
        type: record.RECEIPT_TYPE == null ? "" : String(record.RECEIPT_TYPE).trim(),
        receiptNo: record.RECEIPT_NO == null ? "" : String(record.RECEIPT_NO),
        hospital: record.HOSPITAL_CDE == null ? "" : String(record.HOSPITAL_CDE),
        caseNo: record.CASE_NO == null ? "" : String(record.CASE_NO),
        amount: record.RECEIPT_AMT == null ? "" : String(record.RECEIPT_AMT),
        payment: record.PAYMENT_MEANS == null ? "" : String(record.PAYMENT_MEANS),
        status: record.STATUS_CDE == null ? "" : String(record.STATUS_CDE),
        side: record.CR_DR == null ? "" : String(record.CR_DR),
        user: record.FC_USER == null ? "" : String(record.FC_USER),
        ws: record.FC_WS == null ? "" : String(record.FC_WS),
        at: record.AT_TIME == null ? "" : String(record.AT_TIME),
        count: Number(record.CNT || 0)
      };
    });
    rows.sort(function (a, b) {
      var ia = known.indexOf(a.type);
      var ib = known.indexOf(b.type);
      if (ia < 0 && ib < 0) return a.type.localeCompare(b.type);
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    });
    out.receiptLatest = { ran: true, reason: "", rows: rows, sql: sql };
    out.sql.push("Latest receipt of each type\n" + sql);
  } catch (err) {
    out.receiptLatest = { ran: false, reason: safeMessage(err), rows: [], sql: sql };
    out.sql.push("Latest receipt of each type\n" + sql);
  }
}

async function readLatestCreate(conn, cred, out, indexes, job) {
  var specs = [
    { table: "MED_PROFILE_CHARGE_HDR", source: "med_profile_charge_hdr" },
    { table: "MED_PROFILE_CHARGE_DETAIL", source: "med_profile_charge_detail" }
  ];
  out.latestCreate = [];
  for (var i = 0; i < specs.length; i++) {
    if (job && job.cancelled) throw disconnected();
    var spec = specs[i];
    var shape = indexLead(indexes[spec.table], "CREATE_DTM", "PAT_HOSPCODE");
    var sql = "";
    var binds = {};
    var scope = "";
    if ((shape === "hosp" || shape === "both") && cred.hospital) {
      sql = "SELECT TO_CHAR(MAX(create_dtm), 'YYYY-MM-DD HH24:MI:SS') AS latest FROM " + spec.source + " WHERE pat_hospcode = :hosp";
      binds = { hosp: cred.hospital };
      scope = cred.hospital;
    } else if (shape === "date" || shape === "both") {
      sql = "SELECT TO_CHAR(MAX(create_dtm), 'YYYY-MM-DD HH24:MI:SS') AS latest FROM " + spec.source;
      scope = "Whole table";
    } else if (shape === "hosp") {
      out.latestCreate.push({ table: spec.source, ran: false, latest: "", scope: "", reason: "Enter a hospital. The index starts with PAT_HOSPCODE, then CREATE_DTM." });
      continue;
    } else {
      out.latestCreate.push({ table: spec.source, ran: false, latest: "", scope: "", reason: "No valid index leads with CREATE_DTM, or with PAT_HOSPCODE and then CREATE_DTM. The latest time was not read." });
      continue;
    }
    var rows = await q(conn, sql, binds, 1);
    var latest = rows[0] && rows[0].LATEST ? String(rows[0].LATEST) : "";
    out.latestCreate.push({ table: spec.source, ran: true, latest: latest, scope: scope, reason: "", sql: sql });
    out.sql.push(spec.source + " latest create_dtm\n" + sql);
  }
}

function fact(id, title, table, source, dateCol, hospCol, measure, list) {
  return { id: id, title: title, table: table, source: source, dateCol: dateCol, hospCol: hospCol, measure: measure, list: list };
}

async function readMoeMonitor(conn, out, indexes, job) {
  if (job && job.cancelled) throw disconnected();
  var logShape = indexLead(indexes.MED_PROFILE_CHARGE_HDR_LOG, "LOG_DTM", "PAT_HOSPCODE");
  var headerShape = indexLead(indexes.MED_PROFILE_CHARGE_HDR, "CREATE_DTM", "PAT_HOSPCODE");
  var detailShape = indexLead(indexes.MED_PROFILE_CHARGE_DETAIL, "CREATE_DTM", "PAT_HOSPCODE");
  var headerHosp = logShape === "hosp" || logShape === "both" || headerShape === "hosp" || headerShape === "both";
  var detailHosp = detailShape === "hosp" || detailShape === "both";
  var headerDate = !headerHosp && (logShape === "date" || headerShape === "date");
  var detailDate = !detailHosp && detailShape === "date";
  out.moeHeader = headerHosp || headerDate;
  out.moeDetail = detailHosp || detailDate;
  out.moe = [];
  if (!out.moeHeader && !out.moeDetail) {
    out.moeRan = true;
    out.moeReason = "No latest row was read. A per-hospital read needs an index that starts with the hospital and then the time. med_profile_charge_hdr_log: " + indexBrief(indexes.MED_PROFILE_CHARGE_HDR_LOG) + ". med_profile_charge_hdr: " + indexBrief(indexes.MED_PROFILE_CHARGE_HDR) + ". med_profile_charge_detail: " + indexBrief(indexes.MED_PROFILE_CHARGE_DETAIL) + ".";
    return;
  }
  var useLog = logShape === "hosp" || logShape === "both" || (!headerHosp && logShape === "date");
  var headerSql = useLog
    ? "SELECT pat_hospcode, TO_CHAR(log_dtm, 'YYYY-MM-DD HH24:MI:SS') AS latest, moe_ord_no FROM med_profile_charge_hdr_log WHERE pat_hospcode = :hosp ORDER BY log_dtm DESC FETCH FIRST 1 ROW ONLY"
    : "SELECT pat_hospcode, TO_CHAR(create_dtm, 'YYYY-MM-DD HH24:MI:SS') AS latest, moe_ord_no FROM med_profile_charge_hdr WHERE pat_hospcode = :hosp ORDER BY create_dtm DESC FETCH FIRST 1 ROW ONLY";
  var headerAllSql = useLog
    ? "SELECT pat_hospcode, TO_CHAR(log_dtm, 'YYYY-MM-DD HH24:MI:SS') AS latest, moe_ord_no FROM med_profile_charge_hdr_log ORDER BY log_dtm DESC FETCH FIRST 1 ROW ONLY"
    : "SELECT pat_hospcode, TO_CHAR(create_dtm, 'YYYY-MM-DD HH24:MI:SS') AS latest, moe_ord_no FROM med_profile_charge_hdr ORDER BY create_dtm DESC FETCH FIRST 1 ROW ONLY";
  var detailSql = "SELECT TO_CHAR(create_dtm, 'YYYY-MM-DD HH24:MI:SS') AS latest, moe_ord_no FROM med_profile_charge_detail WHERE pat_hospcode = :hosp ORDER BY create_dtm DESC FETCH FIRST 1 ROW ONLY";
  var detailAllSql = "SELECT pat_hospcode, TO_CHAR(create_dtm, 'YYYY-MM-DD HH24:MI:SS') AS latest, moe_ord_no FROM med_profile_charge_detail ORDER BY create_dtm DESC FETCH FIRST 1 ROW ONLY";
  try {
    if (headerHosp || detailHosp) {
      var listed = await q(conn, "SELECT DISTINCT TRIM(hospital_cde) AS hospital_cde FROM fc_hospital_codes WHERE TRIM(hospital_cde) IS NOT NULL ORDER BY 1", {}, 81);
      if (listed.length > 80) {
        out.moeRan = true;
        out.moeReason = "fc_hospital_codes returned more than 80 hospital codes, so the latest-row reads were not run.";
        return;
      }
      var codes = listed.map(function (row) { return String(row.HOSPITAL_CDE || "").trim(); }).filter(function (code) { return /^[A-Z0-9]{1,10}$/.test(code); });
      for (var i = 0; i < codes.length; i++) {
        if (job && job.cancelled) throw disconnected();
        var code = codes[i];
        var item = { hospital: code, headerAt: "", headerOrder: "", detailAt: "", detailOrder: "" };
        if (headerHosp) {
          var header = await q(conn, headerSql, { hosp: code }, 1);
          if (header[0]) {
            item.headerAt = header[0].LATEST || "";
            item.headerOrder = header[0].MOE_ORD_NO == null ? "" : String(header[0].MOE_ORD_NO);
          }
        }
        if (detailHosp) {
          var detail = await q(conn, detailSql, { hosp: code }, 1);
          if (detail[0]) {
            item.detailAt = detail[0].LATEST || "";
            item.detailOrder = detail[0].MOE_ORD_NO == null ? "" : String(detail[0].MOE_ORD_NO);
          }
        }
        out.moe.push(item);
      }
      out.moeReason = "";
      if (headerHosp) out.sql.push("Latest MOE header for one hospital\n" + headerSql);
      if (detailHosp) out.sql.push("Latest med profile detail for one hospital\n" + detailSql);
    }
    if (headerDate) {
      if (job && job.cancelled) throw disconnected();
      var oneHeader = await q(conn, headerAllSql, {}, 1);
      var headerRow = oneHeader[0] || {};
      out.moe.push({
        hospital: headerRow.PAT_HOSPCODE || "All",
        headerAt: headerRow.LATEST || "",
        headerOrder: headerRow.MOE_ORD_NO == null ? "" : String(headerRow.MOE_ORD_NO),
        detailAt: "",
        detailOrder: ""
      });
      out.sql.push("Newest MOE header in the table\n" + headerAllSql);
    }
    if (detailDate) {
      if (job && job.cancelled) throw disconnected();
      var oneDetail = await q(conn, detailAllSql, {}, 1);
      var detailRow = oneDetail[0] || {};
      var hosp = detailRow.PAT_HOSPCODE || "All";
      var existing = out.moe.filter(function (row) { return row.hospital === hosp; })[0];
      if (!existing) {
        existing = { hospital: hosp, headerAt: "", headerOrder: "", detailAt: "", detailOrder: "" };
        out.moe.push(existing);
      }
      existing.detailAt = detailRow.LATEST || "";
      existing.detailOrder = detailRow.MOE_ORD_NO == null ? "" : String(detailRow.MOE_ORD_NO);
      out.sql.push("Newest med profile detail in the table\n" + detailAllSql);
    }
    out.moe.sort(function (a, b) {
      var at = (a.headerAt || a.detailAt || "");
      var bt = (b.headerAt || b.detailAt || "");
      if (at < bt) return -1;
      if (at > bt) return 1;
      return a.hospital < b.hospital ? -1 : a.hospital > b.hospital ? 1 : 0;
    });
    out.moeRan = true;
    if (!out.moeReason) {
      out.moeReason = headerHosp || detailHosp
        ? ""
        : "The index starts with the time, so this is the newest row in the table. It is not one row per hospital.";
    }
  } catch (err) {
    if (job && job.cancelled) throw err;
    out.moe = [];
    out.moeRan = false;
    out.moeReason = safeMessage(err);
  }
}

async function readSeats(conn, cred, out) {
  var rows = await q(conn,
    "SELECT fc_sys, COUNT(*) AS seats, SUM(CASE WHEN upd_dtm >= TO_DATE(:day, 'YYYY-MM-DD') AND upd_dtm < TO_DATE(:day, 'YYYY-MM-DD') + 1 THEN 1 ELSE 0 END) AS active_seats, TO_CHAR(MAX(upd_dtm), 'YYYY-MM-DD HH24:MI:SS') AS latest FROM fc_user_ws_list WHERE hospital_cde = :hosp GROUP BY fc_sys ORDER BY fc_sys",
    { hosp: cred.hospital, day: out.day }, 50);
  out.seats = {
    ran: true,
    sql: "SELECT fc_sys, COUNT(*) AS seats, SUM(CASE WHEN upd_dtm >= TO_DATE(:day, 'YYYY-MM-DD') AND upd_dtm < TO_DATE(:day, 'YYYY-MM-DD') + 1 THEN 1 ELSE 0 END) AS active_seats, TO_CHAR(MAX(upd_dtm), 'YYYY-MM-DD HH24:MI:SS') AS latest FROM fc_user_ws_list WHERE hospital_cde = :hosp GROUP BY fc_sys ORDER BY fc_sys",
    reason: "Each row in fc_user_ws_list is the latest receipt save for one user and workstation. This is how many of those seats last saved on this day, not how many receipts were written.",
    rows: rows.map(function (r) {
      return {
        sys: r.FC_SYS == null ? "" : String(r.FC_SYS),
        seats: Number(r.SEATS),
        active: Number(r.ACTIVE_SEATS),
        latest: r.LATEST || ""
      };
    })
  };
}

async function readFlow(conn, cred, out) {
  var indexes = await loadIndexes(conn);
  var day = " >= TO_DATE(:day, 'YYYY-MM-DD') AND ";
  var next = " < TO_DATE(:day, 'YYYY-MM-DD') + 1";
  var steps = [
    {
      id: "hdr",
      label: "MOE header",
      tries: [
        stepTry("MED_PROFILE_CHARGE_HDR_LOG", "LOG_DTM", "PAT_HOSPCODE", "med_profile_charge_hdr_log",
          "SELECT COUNT(*) AS cnt, TO_CHAR(MAX(log_dtm), 'YYYY-MM-DD HH24:MI:SS') AS latest FROM med_profile_charge_hdr_log WHERE pat_hospcode = :hosp AND log_dtm" + day + "log_dtm" + next),
        stepTry("MED_PROFILE_CHARGE_HDR", "CREATE_DTM", "PAT_HOSPCODE", "med_profile_charge_hdr",
          "SELECT COUNT(*) AS cnt, TO_CHAR(MAX(create_dtm), 'YYYY-MM-DD HH24:MI:SS') AS latest FROM med_profile_charge_hdr WHERE pat_hospcode = :hosp AND create_dtm" + day + "create_dtm" + next)
      ],
      miss: "No valid index leads with LOG_DTM or CREATE_DTM, or with the hospital and then that time."
    },
    {
      id: "detail",
      label: "Med detail",
      tries: [
        stepTry("MED_PROFILE_CHARGE_DETAIL", "CREATE_DTM", "PAT_HOSPCODE", "med_profile_charge_detail",
          "SELECT COUNT(*) AS cnt, TO_CHAR(MAX(create_dtm), 'YYYY-MM-DD HH24:MI:SS') AS latest FROM med_profile_charge_detail WHERE pat_hospcode = :hosp AND create_dtm" + day + "create_dtm" + next)
      ],
      miss: "No valid index leads with CREATE_DTM, or with PAT_HOSPCODE and then CREATE_DTM. The detail log is not written, so this uses the create time on the detail row."
    },
    {
      id: "charge",
      label: "Drug charging",
      tries: [
        stepTry("FC_DRUG_CHARGING", "FC_UPD_DTM", "HOSPITAL_CDE", "fc_drug_charging",
          "SELECT COUNT(*) AS cnt, TO_CHAR(MAX(fc_upd_dtm), 'YYYY-MM-DD HH24:MI:SS') AS latest FROM fc_drug_charging WHERE hospital_cde = :hosp AND fc_upd_dtm" + day + "fc_upd_dtm" + next)
      ],
      miss: "No valid index leads with FC_UPD_DTM, or with HOSPITAL_CDE and then FC_UPD_DTM. The detail trigger writes this time."
    },
    {
      id: "case",
      label: "Case service",
      tries: [
        stepTry("FC_CASE_SERVICES", "UPD_DTM", "HOSPITAL_CDE", "fc_case_services",
          "SELECT COUNT(*) AS cnt, TO_CHAR(MAX(upd_dtm), 'YYYY-MM-DD HH24:MI:SS') AS latest FROM fc_case_services WHERE hospital_cde = :hosp AND upd_dtm" + day + "upd_dtm" + next)
      ],
      miss: "No valid index leads with UPD_DTM, or with HOSPITAL_CDE and then UPD_DTM."
    },
    {
      id: "sfi",
      label: "SFI charging",
      tries: [
        stepTry("FC_SFI_CHARGING", "UPD_DTM", "HOSPITAL_CDE", "fc_sfi_charging",
          "SELECT COUNT(*) AS cnt, TO_CHAR(MAX(upd_dtm), 'YYYY-MM-DD HH24:MI:SS') AS latest FROM fc_sfi_charging WHERE hospital_cde = :hosp AND upd_dtm" + day + "upd_dtm" + next)
      ],
      miss: "No valid index leads with UPD_DTM, or with HOSPITAL_CDE and then UPD_DTM."
    },
    {
      id: "exc",
      label: "Detail exceptions",
      tries: [
        stepTry("FC_MED_DETAIL_EXCEPTION", "ERROR_DTM", "PAT_HOSPCODE", "fc_med_detail_exception",
          "SELECT COUNT(*) AS cnt, TO_CHAR(MAX(error_dtm), 'YYYY-MM-DD HH24:MI:SS') AS latest FROM fc_med_detail_exception WHERE pat_hospcode = :hosp AND error_dtm" + day + "error_dtm" + next)
      ],
      miss: "No valid index leads with ERROR_DTM, or with PAT_HOSPCODE and then ERROR_DTM."
    }
  ];
  out.flow = [];
  for (var i = 0; i < steps.length; i++) {
    out.flow.push(await oneStep(conn, cred, out.day, indexes, steps[i]));
  }
  out.headerHours = hoursOf(out, "hdr", "Med header", steps[0].miss);
  out.detailHours = hoursOf(out, "detail", "Med detail", steps[1].miss);
  out.chargeHours = hoursOf(out, "charge", "Drug charging", steps[2].miss);
  out.caseHours = hoursOf(out, "case", "Case service", steps[3].miss);
  out.sfiHours = hoursOf(out, "sfi", "SFI charging written", steps[4].miss);
  out.exceptionHours = hoursOf(out, "exc", "Detail exceptions", steps[5].miss);
  out.moeHours = out.headerHours;
  await readRecent(conn, cred, out, indexes);
  if (usable(indexes.FC_RECEIPTS, "RECEIPT_DTM", "HOSPITAL_CDE")) {
    await readReceipts(conn, cred, out);
  } else {
    var why = "No valid index leads with RECEIPT_DTM, or with HOSPITAL_CDE and then RECEIPT_DTM. A day count would read fc_receipts, so it was not run.";
    out.receiptTypes = skipped("Saved receipts by type", why);
    out.receiptHours = skipped("Saved receipts", why);
  }
}

async function readRecent(conn, cred, out, indexes) {
  out.recentHeader = await recentCount(conn, cred, out, indexes, {
    table: "MED_PROFILE_CHARGE_HDR",
    dateCol: "CREATE_DTM",
    hospCol: "PAT_HOSPCODE",
    source: "med_profile_charge_hdr",
    label: "med_profile_charge_hdr"
  });
  out.recentDetail = await recentCount(conn, cred, out, indexes, {
    table: "MED_PROFILE_CHARGE_DETAIL",
    dateCol: "CREATE_DTM",
    hospCol: "PAT_HOSPCODE",
    source: "med_profile_charge_detail",
    label: "med_profile_charge_detail"
  });
}

async function recentCount(conn, cred, out, indexes, spec) {
  var miss = "No valid index leads with CREATE_DTM, or with PAT_HOSPCODE and then CREATE_DTM. The last hour was not read.";
  if (!usable(indexes[spec.table], spec.dateCol, spec.hospCol)) return skipped(spec.label, miss);
  var col = spec.dateCol.toLowerCase();
  var hospCol = spec.hospCol.toLowerCase();
  var sql = "SELECT TO_CHAR(" + col + ", 'HH24:MI') AS mm, COUNT(*) AS cnt FROM " + spec.source + " WHERE " + hospCol + " = :hosp AND " + col + " >= SYSDATE - INTERVAL '1' HOUR AND " + col + " < SYSDATE GROUP BY TO_CHAR(" + col + ", 'HH24:MI')";
  try {
    var rows = await q(conn, sql, { hosp: cred.hospital }, 120);
    return { ran: true, reason: "", label: spec.label, source: spec.source, sql: sql, rows: fillMinutes(out.now, rows) };
  } catch (err) {
    return { ran: false, reason: safeMessage(err), label: spec.label, source: spec.source, sql: sql, rows: [] };
  }
}

function fillMinutes(nowText, rows) {
  var match = String(nowText || "").match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!match) return [];
  var end = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  var by = {};
  rows.forEach(function (row) { by[String(row.MM)] = Number(row.CNT || 0); });
  var points = [];
  for (var i = 59; i >= 0; i--) {
    var t = new Date(end - i * 60000);
    var key = pad2(t.getUTCHours()) + ":" + pad2(t.getUTCMinutes());
    points.push({ time: key, count: by[key] || 0 });
  }
  return points;
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

function hoursOf(out, id, label, miss) {
  var step = (out.flow || []).filter(function (item) { return item.id === id; })[0];
  if (step && step.hourly && step.hourly.ran) return step.hourly;
  var why = (step && step.hourly && step.hourly.reason) || (step && step.reason) || miss;
  return skipped(label, why);
}

function stepTry(table, dateCol, hospCol, source, sql) {
  return { table: table, dateCol: dateCol, hospCol: hospCol, source: source, sql: sql };
}

async function oneStep(conn, cred, day, indexes, spec) {
  var chosen = null;
  for (var i = 0; i < spec.tries.length; i++) {
    var attempt = spec.tries[i];
    if (usable(indexes[attempt.table], attempt.dateCol, attempt.hospCol)) {
      chosen = attempt;
      break;
    }
  }
  if (!chosen) {
    return { id: spec.id, label: spec.label, ran: false, reason: spec.miss, source: "", count: null, latest: "" };
  }
  try {
    var rows = await q(conn, chosen.sql, { hosp: cred.hospital, day: day }, 1);
    var row = rows[0] || {};
    var result = {
      id: spec.id,
      label: spec.label,
      ran: true,
      reason: "",
      source: chosen.source,
      count: Number(row.CNT || 0),
      latest: row.LATEST || ""
    };
    if (spec.id === "hdr" || spec.id === "detail" || spec.id === "charge" || spec.id === "case" || spec.id === "sfi") {
      try { result.hourly = await hourSeries(conn, cred, day, chosen, spec.id); }
      catch (err) {
        result.hourly = { ran: false, reason: safeMessage(err), label: spec.label, source: chosen.source, rows: [] };
      }
    }
    return result;
  } catch (err) {
    return { id: spec.id, label: spec.label, ran: false, reason: safeMessage(err), source: chosen.source, count: null, latest: "" };
  }
}

async function readReceipts(conn, cred, out) {
  var sql = "SELECT receipt_type, TO_CHAR(receipt_dtm, 'HH24') AS hh, COUNT(*) AS cnt FROM fc_receipts WHERE status_cde = 'IS' AND cr_dr = 'D' AND hospital_cde = :hosp AND receipt_dtm >= TO_DATE(:day, 'YYYY-MM-DD') AND receipt_dtm < TO_DATE(:day, 'YYYY-MM-DD') + 1 GROUP BY receipt_type, TO_CHAR(receipt_dtm, 'HH24')";
  var rows = await q(conn, sql, { hosp: cred.hospital, day: out.day }, 400);
  var known = ["DR", "DD", "DF", "DV", "DH"];
  var byType = {};
  var byHour = {};
  var byTypeHour = {};
  known.forEach(function (type) { byType[type] = 0; byTypeHour[type] = {}; });
  rows.forEach(function (r) {
    var type = r.RECEIPT_TYPE == null ? "" : String(r.RECEIPT_TYPE).trim();
    var hour = String(r.HH);
    var count = Number(r.CNT || 0);
    if (!byTypeHour[type]) byTypeHour[type] = {};
    byType[type] = (byType[type] || 0) + count;
    byTypeHour[type][hour] = (byTypeHour[type][hour] || 0) + count;
    byHour[hour] = (byHour[hour] || 0) + count;
  });
  var types = known.concat(Object.keys(byType).filter(function (type) { return known.indexOf(type) < 0; }));
  var typeRows = types.map(function (type) {
    return { type: type, count: byType[type] || 0, hours: fillHours(byTypeHour[type] || {}) };
  });
  out.receiptTypes = { ran: true, reason: "", label: "Saved receipts by type", source: "fc_receipts", sql: sql, rows: typeRows };
  out.receiptHours = {
    ran: true,
    reason: "",
    label: "Saved receipts",
    source: "fc_receipts",
    sql: sql,
    rows: fillHours(byHour)
  };
}

async function hourSeries(conn, cred, day, chosen, id) {
  var col = String(chosen.dateCol || "").toLowerCase();
  var hospCol = String(chosen.hospCol || "").toLowerCase();
  var source = chosen.source;
  if (!/^[a-z_]+$/.test(col) || !/^[a-z_]+$/.test(hospCol) || !/^[a-z_]+$/.test(source)) {
    return { ran: false, reason: "The hour count was not run.", label: "", source: source, rows: [] };
  }
  var sql = "SELECT TO_CHAR(" + col + ", 'HH24') AS hh, COUNT(*) AS cnt FROM " + source + " WHERE " + hospCol + " = :hosp AND " + col + " >= TO_DATE(:day, 'YYYY-MM-DD') AND " + col + " < TO_DATE(:day, 'YYYY-MM-DD') + 1 GROUP BY TO_CHAR(" + col + ", 'HH24')";
  var rows = await q(conn, sql, { hosp: cred.hospital, day: day }, 24);
  var byHour = {};
  rows.forEach(function (r) { byHour[String(r.HH)] = Number(r.CNT); });
  var labels = {
    hdr: source === "med_profile_charge_hdr" ? "MOE headers with this create time" : "Med header arrived",
    detail: "Med detail create time",
    charge: "Drug charging written",
    case: "Case service updated",
    sfi: "SFI charging written",
    exc: "Detail exceptions"
  };
  var label = labels[id] || source;
  return { ran: true, reason: "", label: label, source: source, sql: sql, rows: fillHours(byHour) };
}

function fillHours(byHour) {
  var filled = [];
  for (var h = 0; h < 24; h++) {
    var key = (h < 10 ? "0" : "") + h;
    filled.push({ hour: key, count: byHour[key] || 0 });
  }
  return filled;
}

function inList(names) {
  return names.map(function (name) { return "'" + name + "'"; }).join(",");
}

async function loadIndexes(conn) {
  var meRows = await q(conn, "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS me FROM dual", {}, 1);
  var me = meRows[0] ? meRows[0].ME : "";
  var synonyms = await q(conn,
    "SELECT synonym_name, table_owner, table_name, owner FROM all_synonyms WHERE synonym_name IN (" + inList(NAMES) + ") AND owner IN (:me, 'PUBLIC')",
    { me: me }, 40);
  var tables = await q(conn,
    "SELECT table_name FROM user_tables WHERE table_name IN (" + inList(NAMES) + ")",
    {}, 20);
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
      { owner: item.owner, name: item.name }, 200);
  }
  return indexes;
}

function indexBrief(rows) {
  var by = {};
  (rows || []).forEach(function (r) {
    var name = r.INDEX_NAME || "";
    if (!by[name]) by[name] = [];
    by[name].push(r);
  });
  var names = Object.keys(by);
  if (!names.length) return "no index columns visible";
  return names.map(function (name) {
    var cols = by[name].sort(function (a, b) { return Number(a.COLUMN_POSITION) - Number(b.COLUMN_POSITION); });
    var status = cols[0] && cols[0].STATUS ? cols[0].STATUS : "";
    return name + " " + status + " (" + cols.map(function (col) { return col.COLUMN_NAME; }).join(", ") + ")";
  }).join("; ");
}

function indexGroups(rows) {
  var by = {};
  (rows || []).forEach(function (r) {
    if (r.STATUS !== "VALID") return;
    if (!by[r.INDEX_NAME]) by[r.INDEX_NAME] = [];
    by[r.INDEX_NAME].push(r);
  });
  return by;
}

function indexLead(rows, dateCol, hospCol) {
  var by = indexGroups(rows);
  var dateLead = false;
  var hospLead = false;
  Object.keys(by).forEach(function (name) {
    var cols = by[name].sort(function (a, b) { return Number(a.COLUMN_POSITION) - Number(b.COLUMN_POSITION); });
    var first = cols[0] && cols[0].COLUMN_NAME;
    var second = cols[1] && cols[1].COLUMN_NAME;
    if (first === dateCol) dateLead = true;
    if (hospCol && first === hospCol && second === dateCol) hospLead = true;
  });
  if (hospLead && dateLead) return "both";
  if (hospLead) return "hosp";
  if (dateLead) return "date";
  return "";
}

function usable(rows, dateCol, hospCol) {
  var lead = indexLead(rows, dateCol, hospCol);
  if (!hospCol) return lead === "date" || lead === "both";
  return lead === "date" || lead === "hosp" || lead === "both";
}

function skipped(label, reason) {
  return { ran: false, reason: reason, label: label, source: "", rows: [] };
}

async function q(conn, sql, binds, maxRows) {
  var result = await conn.execute(sql, binds || {}, { maxRows: maxRows || 200 });
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
  if (timedOut(err)) return "A read did not finish within 8 seconds. The check stopped. Nothing was written.";
  var text = String(err && err.message || "The database check failed.");
  text = text.replace(/password[=:]\s*\S+/ig, "password");
  if (text.length > 280) text = text.slice(0, 280);
  return text;
}

function timedOut(err) {
  var text = String(err && (err.message || err.code) || "");
  return err.code === "NJS-510" || /call timeout|NJS-510|DPI-1067/i.test(text);
}

module.exports = { run: run, disconnect: disconnect, easyConnect: easyConnect };
