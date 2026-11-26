var fs = require("fs");
var path = require("path");
var url = require("url");
var zlib = require("zlib");

var EXPORT_DIR = "C:\\Users\\CCK585\\Desktop\\Doc\\FCS\\cms_api_cross_check\\all_exports";
var SUMMARY_PATH = path.join(EXPORT_DIR, "prod-cr-page.json");
var DIFF_ZIP = "prod_cr_differences.zip";
var PAGE = 30;

var PAIR_SPEC = {
  hdr: {
    file: "11_med_profile_charge_hdr_differences.csv",
    title: "MED_PROFILE_CHARGE_HDR",
    keys: ["PAT_HOSPCODE", "MOE_ORD_NO"],
    labels: ["Hospital", "MOE"]
  },
  detail: {
    file: "12_med_profile_charge_detail_differences.csv",
    title: "MED_PROFILE_CHARGE_DETAIL",
    keys: ["PAT_HOSPCODE", "MOE_ORD_NO", "ITEM_NO"],
    labels: ["Hospital", "MOE", "Item"]
  },
  drug: {
    file: "13_fc_drug_charging_differences.csv",
    title: "FC_DRUG_CHARGING",
    keys: ["HOSPITAL_CDE", "MOE_ORDER_NO", "SEQ_NO"],
    labels: ["Hospital", "MOE", "Seq"]
  },
  case: {
    file: "14_fc_case_services_differences.csv",
    title: "FC_CASE_SERVICES",
    keys: ["HOSPITAL_CDE", "CASE_NO"],
    labels: ["Hospital", "Case"],
    service: true
  }
};

var ZIP_LINKS = [
  ["cr_all.zip", "Current CR extract"],
  ["cr_new.zip", "CR rows added since 2 Nov"],
  ["cr_export.zip", "CR extract, 2 Nov"],
  ["prod_export.zip", "Production extract"],
  ["prod_cr_differences.zip", "All differences"],
  ["fcs_cr_export_scripts.zip", "Python scripts"]
];

var summary = null;
var summaryError = "";
var downloads = [];
var tables = {};
var zipIndex = {};
var ready;
var failed = "";

function loadSummary() {
  var raw = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8"));
  delete raw.exportDir;
  delete raw.downloads;
  summary = raw;
}

function fileBytes(name) {
  var full = path.join(EXPORT_DIR, name);
  try {
    var st = fs.statSync(full);
    return st.isFile() ? st.size : 0;
  } catch (err) {
    return 0;
  }
}

function buildDownloads() {
  var items = [];
  ZIP_LINKS.forEach(function (pair) {
    var bytes = fileBytes(pair[0]);
    if (bytes >= 1000) items.push({ name: pair[0], bytes: bytes, note: pair[1] });
  });
  var summaryBytes = fileBytes("summary.txt");
  if (summaryBytes > 0) items.push({ name: "summary.txt", bytes: summaryBytes, note: "Export run summary with counts and timings" });
  downloads = items;
}

function centralDirectory(file) {
  var fd = fs.openSync(file, "r");
  try {
    var size = fs.fstatSync(fd).size;
    var tailLen = Math.min(size, 22 + 65535);
    var tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    var sig = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (sig < 0) throw new Error("zip");
    var count = tail.readUInt16LE(sig + 10);
    var cdSize = tail.readUInt32LE(sig + 12);
    var cdOff = tail.readUInt32LE(sig + 16);
    if (cdOff === 0xffffffff || cdSize === 0xffffffff) throw new Error("zip64");
    var cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    var entries = {};
    var p = 0;
    for (var i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error("zip");
      var method = cd.readUInt16LE(p + 10);
      var comp = cd.readUInt32LE(p + 20);
      var uncomp = cd.readUInt32LE(p + 24);
      var nameLen = cd.readUInt16LE(p + 28);
      var extra = cd.readUInt16LE(p + 30);
      var comment = cd.readUInt16LE(p + 32);
      var localOff = cd.readUInt32LE(p + 42);
      var name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      entries[name] = { method: method, comp: comp, uncomp: uncomp, localOff: localOff, dataOff: 0 };
      p += 46 + nameLen + extra + comment;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

function indexZips() {
  fs.readdirSync(EXPORT_DIR).forEach(function (name) {
    if (!name.toLowerCase().endsWith(".zip")) return;
    var full = path.join(EXPORT_DIR, name);
    try {
      zipIndex[name] = { path: full, entries: centralDirectory(full) };
    } catch (err) {
      console.log("prod-cr skipped " + name);
    }
  });
}

function readEntry(zipName, member) {
  var zip = zipIndex[zipName];
  if (!zip || !zip.entries[member]) return null;
  var entry = zip.entries[member];
  var fd = fs.openSync(zip.path, "r");
  try {
    if (!entry.dataOff) {
      var local = Buffer.alloc(30);
      fs.readSync(fd, local, 0, 30, entry.localOff);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error("zip");
      entry.dataOff = entry.localOff + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    }
    var comp = Buffer.alloc(entry.comp);
    fs.readSync(fd, comp, 0, entry.comp, entry.dataOff);
    if (entry.method === 0) return comp;
    if (entry.method === 8) return zlib.inflateRawSync(comp);
    throw new Error("zip method");
  } finally {
    fs.closeSync(fd);
  }
}

function stripCr(line) {
  if (line && line.charCodeAt(line.length - 1) === 13) return line.slice(0, -1);
  return line;
}

function splitCsv(line) {
  var out = [];
  var cur = "";
  var quoted = false;
  for (var i = 0; i < line.length; i++) {
    var c = line.charCodeAt(i);
    if (quoted) {
      if (c === 34) {
        if (line.charCodeAt(i + 1) === 34) {
          cur += "\"";
          i++;
        } else quoted = false;
      } else cur += line.charAt(i);
    } else if (c === 34) quoted = true;
    else if (c === 44) {
      out.push(cur);
      cur = "";
    } else cur += line.charAt(i);
  }
  out.push(cur);
  return out;
}

function prepare(code) {
  var spec = PAIR_SPEC[code];
  var buf = readEntry(DIFF_ZIP, spec.file);
  if (!buf) throw new Error("missing " + spec.file);
  var text = buf.toString("utf8");
  buf = null;
  var rawLines = text.split("\n");
  text = null;
  if (rawLines.length && rawLines[rawLines.length - 1] === "") rawLines.pop();
  var header = splitCsv(stripCr(rawLines[0] || ""));
  var at = {};
  header.forEach(function (name, i) { at[name] = i; });
  var fields = [];
  if (spec.service) {
    fields.push({ name: "SERVICE_DTM", cr: at.SERVICE_DTM, prod: at.PROD_SERVICE_DTM });
  }
  header.forEach(function (name) {
    if (name.indexOf("CR_") !== 0) return;
    var base = name.slice(3);
    var prodName = "PROD_" + base;
    if (at[prodName] == null) return;
    fields.push({ name: base, cr: at[name], prod: at[prodName] });
  });
  var lines = [];
  var mask = [];
  var after = [];
  var afterAt = at.PROD_CHANGED_AFTER_CUTOFF;
  for (var i = 1; i < rawLines.length; i++) {
    var line = stripCr(rawLines[i]);
    if (!line) continue;
    var cols = splitCsv(line);
    var bits = 0;
    for (var f = 0; f < fields.length; f++) {
      if (cols[fields[f].cr] !== cols[fields[f].prod]) bits |= (1 << f);
    }
    lines.push(line);
    mask.push(bits);
    after.push(cols[afterAt] === "Y" ? 1 : 0);
  }
  rawLines = null;
  tables[code] = {
    spec: spec,
    fields: fields,
    columns: fields.map(function (field) { return field.name; }),
    keyAt: spec.keys.map(function (name) { return at[name]; }),
    lines: lines,
    mask: mask,
    after: after
  };
  console.log("prod-cr " + code + " " + lines.length);
}

function loadAll() {
  var started = Date.now();
  loadSummary();
  buildDownloads();
  indexZips();
  Object.keys(PAIR_SPEC).forEach(prepare);
  console.log("prod-cr ready in " + ((Date.now() - started) / 1000).toFixed(1) + "s");
}

ready = new Promise(function (resolve) {
  setImmediate(function () {
    try {
      loadAll();
      resolve();
    } catch (err) {
      failed = "The comparison files could not be read.";
      summaryError = failed;
      console.log("prod-cr load failed: " + err.message);
      resolve();
    }
  });
});

function hasText(value, needle) {
  return String(value == null ? "" : value).toLowerCase().indexOf(needle) >= 0;
}

function buildPairs(msg) {
  var code = msg && msg.table;
  var tab = tables[code];
  if (!tab) return { error: "Unknown table." };
  var requested = msg.columns;
  var visible;
  if (requested == null) visible = tab.columns.slice();
  else if (!Array.isArray(requested)) visible = tab.columns.slice();
  else {
    var wanted = {};
    requested.forEach(function (name) { if (typeof name === "string") wanted[name] = true; });
    visible = tab.columns.filter(function (name) { return wanted[name]; });
  }
  var filters = msg.filters && typeof msg.filters === "object" ? msg.filters : {};
  var needles = [];
  Object.keys(filters).forEach(function (name) {
    var text = filters[name];
    if (typeof text !== "string" || !text) return;
    needles.push([name, text.toLowerCase()]);
  });
  var visibleMask = 0;
  var visibleAt = {};
  visible.forEach(function (name) {
    var at = tab.columns.indexOf(name);
    if (at >= 0) {
      visibleMask |= (1 << at);
      visibleAt[name] = at;
    }
  });
  var allOn = visible.length === tab.columns.length;
  var matched = [];
  if (visibleMask !== 0) {
    if (!needles.length && allOn) {
      matched = null;
    } else {
      for (var i = 0; i < tab.lines.length; i++) {
        if ((tab.mask[i] & visibleMask) === 0) continue;
        if (needles.length && !rowMatches(tab, tab.lines[i], needles)) continue;
        matched.push(i);
      }
    }
  }
  var total = matched === null ? tab.lines.length : matched.length;
  var pages = total ? Math.ceil(total / PAGE) : 0;
  var page = Math.max(1, parseInt(msg.page, 10) || 1);
  if (pages && page > pages) page = pages;
  var start = (page - 1) * PAGE;
  var rows = [];
  if (total && visibleMask) {
    for (var n = start; n < start + PAGE && n < total; n++) {
      var index = matched === null ? n : matched[n];
      rows.push(rowOut(tab, index, visible));
    }
  }
  return {
    table: code,
    title: tab.spec.title,
    page: total ? page : 1,
    pageSize: PAGE,
    pages: pages,
    total: total,
    keys: tab.spec.keys,
    labels: tab.spec.labels,
    columns: tab.columns,
    visible: visible,
    rows: rows
  };
}

function rowMatches(tab, line, needles) {
  var cols = splitCsv(line);
  for (var i = 0; i < needles.length; i++) {
    var name = needles[i][0];
    var needle = needles[i][1];
    var keyAt = tab.spec.keys.indexOf(name);
    if (keyAt >= 0) {
      if (!hasText(cols[tab.keyAt[keyAt]], needle)) return false;
      continue;
    }
    var fieldAt = tab.columns.indexOf(name);
    if (fieldAt < 0) continue;
    var field = tab.fields[fieldAt];
    if (!hasText(cols[field.cr], needle) && !hasText(cols[field.prod], needle)) return false;
  }
  return true;
}

function rowOut(tab, index, visible) {
  var cols = splitCsv(tab.lines[index]);
  var cells = [];
  for (var i = 0; i < visible.length; i++) {
    var field = tab.fields[tab.columns.indexOf(visible[i])];
    var cr = cols[field.cr];
    var prod = cols[field.prod];
    cells.push({ column: field.name, cr: cr, prod: prod, diff: cr !== prod });
  }
  return {
    key: tab.keyAt.map(function (at) { return cols[at]; }),
    after: tab.after[index] === 1,
    cells: cells
  };
}

function sendJson(res, status, obj) {
  var text = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

function sendData(res) {
  ready.then(function () {
    if (!summary) return sendJson(res, 200, { error: summaryError || "The comparison is not ready yet." });
    var body = {};
    Object.keys(summary).forEach(function (key) { body[key] = summary[key]; });
    body.downloads = downloads;
    sendJson(res, 200, body);
  });
}

function sendPairs(msg, res) {
  ready.then(function () {
    if (failed || !tables.hdr) return sendJson(res, 503, { error: failed || "The pairs are not loaded." });
    try {
      var out = buildPairs(msg || {});
      if (out.error) return sendJson(res, 400, out);
      sendJson(res, 200, out);
    } catch (err) {
      sendJson(res, 500, { error: "The pairs could not be read." });
    }
  });
}

function safeName(name) {
  if (typeof name !== "string" || !name || name.length > 180) return "";
  if (name.indexOf("\\") >= 0 || name.indexOf("..") >= 0 || name.indexOf("\0") >= 0) return "";
  var parts = name.split("/");
  if (parts.length > 2) return "";
  if (parts.length === 2 && parts[0] !== "diff") return "";
  var base = parts[parts.length - 1];
  if (!/^[A-Za-z0-9_.-]+\.(csv|zip|txt)$/.test(base)) return "";
  return name;
}

function contentType(name) {
  if (name.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (name.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/zip";
}

function sendFile(req, res) {
  ready.then(function () { sendFileNow(req, res); });
}

function sendFileNow(req, res) {
  var q = url.parse(req.url, true);
  var name = safeName(q.query && q.query.name);
  if (!name) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("The file name is not allowed.");
    return;
  }
  var base = name.split("/").pop();
  var disposition = "attachment; filename=\"" + base + "\"";
  if (name.indexOf("diff/") === 0) {
    streamMember(DIFF_ZIP, base, base, disposition, res);
    return;
  }
  var loose = path.resolve(EXPORT_DIR, base);
  if (loose.indexOf(path.resolve(EXPORT_DIR) + path.sep) !== 0 && loose !== path.resolve(EXPORT_DIR)) {
    res.writeHead(400, { "Cache-Control": "no-store" });
    res.end("no");
    return;
  }
  if (fs.existsSync(loose) && fs.statSync(loose).isFile()) {
    res.writeHead(200, {
      "Content-Type": contentType(base),
      "Content-Disposition": disposition,
      "Content-Length": fs.statSync(loose).size,
      "Cache-Control": "no-store"
    });
    fs.createReadStream(loose).pipe(res);
    return;
  }
  var owners = Object.keys(zipIndex);
  for (var i = 0; i < owners.length; i++) {
    if (zipIndex[owners[i]].entries[base]) {
      streamMember(owners[i], base, base, disposition, res);
      return;
    }
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end("missing");
}

function streamMember(zipName, member, downloadName, disposition, res) {
  var zip = zipIndex[zipName];
  var entry = zip && zip.entries[member];
  if (!entry) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("missing");
    return;
  }
  try {
    if (!entry.dataOff) {
      var fd = fs.openSync(zip.path, "r");
      try {
        var local = Buffer.alloc(30);
        fs.readSync(fd, local, 0, 30, entry.localOff);
        entry.dataOff = entry.localOff + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch (err) {
    res.writeHead(500, { "Cache-Control": "no-store" });
    res.end("The file could not be read.");
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentType(downloadName),
    "Content-Disposition": disposition,
    "Content-Length": entry.uncomp,
    "Cache-Control": "no-store"
  });
  var rs = fs.createReadStream(zip.path, { start: entry.dataOff, end: entry.dataOff + entry.comp - 1 });
  var out = entry.method === 8 ? rs.pipe(zlib.createInflateRaw()) : rs;
  out.on("error", function () { res.destroy(); });
  rs.on("error", function () { res.destroy(); });
  out.pipe(res);
}

module.exports = {
  ready: ready,
  sendData: sendData,
  sendPairs: sendPairs,
  sendFile: sendFile
};
