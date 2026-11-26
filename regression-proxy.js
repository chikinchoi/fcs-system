var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var url = require("url");
var healthDb = require("./health-db");
var dayCount = require("./day-count-db");
var medPath = require("./med-path-db");
var dhpDb = require("./dhp-db");
var prodCr = require("./prod-cr");

var PORT = 8770;
var ROOT = __dirname;
var TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
var WRITE = [
  "savedrug", "savesfi", "inserthkid", "savemedd", "updatemedd",
  "fcspupayha", "batchgenrcpt", "syncsdc", "fcspuprocess", "fcspuf6",
  "updpatient", "unconfirm", "amendorder", "createsfi", "payhacreatesfi",
  "recheckdispense", "drugpayment131", "webpudrug", "batchupload",
  "renameticket", "pharmticket", "drugmachinestatus", "savepayment",
  "saveattend", "cancelreceipt", "/cutoff", "reprint"
];

var server = http.createServer(function (req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  var route = req.url.split("?")[0];
  if (route === "/proxy" && req.method === "POST") {
    readBody(req, function (raw) {
      var msg;
      try { msg = JSON.parse(raw || "{}"); }
      catch (e) { return send(res, 400, { error: "Request is not JSON." }); }
      forward(msg, res);
    });
    return;
  }
  if (route === "/health/disconnect" && req.method === "POST") {
    healthDb.disconnect(function (status, body) { send(res, status, body); });
    return;
  }
  if (route === "/med-path/disconnect" && req.method === "POST") {
    medPath.disconnect(function (status, body) { send(res, status, body); });
    return;
  }
  if (route === "/med-path" && req.method === "POST") {
    readBody(req, function (raw) {
      if (raw.length > 8000) return send(res, 413, { error: "The request is too large." });
      var msg;
      try { msg = JSON.parse(raw || "{}"); }
      catch (e) { return send(res, 400, { error: "Request is not JSON." }); }
      medPath.run(msg, function (status, body) { send(res, status, body); }, res);
    });
    return;
  }
  if (route === "/dhp/disconnect" && req.method === "POST") {
    dhpDb.disconnect(function (status, body) { send(res, status, body); });
    return;
  }
  if (route === "/dhp" && req.method === "POST") {
    readBody(req, function (raw) {
      if (raw.length > 350000) return send(res, 413, { error: "The request is too large." });
      var msg;
      try { msg = JSON.parse(raw || "{}"); }
      catch (e) { return send(res, 400, { error: "Request is not JSON." }); }
      dhpDb.run(msg, function (status, body) { send(res, status, body); }, res);
    });
    return;
  }
  if (route === "/prod-cr" && req.method === "GET") {
    fs.readFile(path.join(ROOT, "prod-cr.html"), function (err, data) {
      if (err) {
        res.writeHead(404, { "Cache-Control": "no-store" });
        res.end("missing");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(data);
    });
    return;
  }
  if (route === "/prod-cr-data" && req.method === "GET") {
    prodCr.sendData(res);
    return;
  }
  if (route === "/prod-cr-pairs" && req.method === "POST") {
    readBody(req, function (raw) {
      if (raw.length > 200000) return send(res, 413, { error: "The request is too large." });
      var msg;
      try { msg = JSON.parse(raw || "{}"); }
      catch (e) { return send(res, 400, { error: "Request is not JSON." }); }
      prodCr.sendPairs(msg, res);
    });
    return;
  }
  if (route === "/prod-cr-file" && req.method === "GET") {
    prodCr.sendFile(req, res);
    return;
  }
  if (route === "/day-count/disconnect" && req.method === "POST") {
    dayCount.disconnect(function (status, body) { send(res, status, body); });
    return;
  }
  if (route === "/day-count" && req.method === "POST") {
    readBody(req, function (raw) {
      if (raw.length > 8000) return send(res, 413, { error: "The request is too large." });
      var msg;
      try { msg = JSON.parse(raw || "{}"); }
      catch (e) { return send(res, 400, { error: "Request is not JSON." }); }
      dayCount.run(msg, function (status, body) { send(res, status, body); }, res);
    });
    return;
  }
  if (route === "/notes/pay-flag" && req.method === "GET") {
    fs.readFile(path.join(ROOT, "notes", "pay-flag.json"), "utf8", function (err, text) {
      if (err) return send(res, 200, { saved: false, rows: null });
      try { send(res, 200, JSON.parse(text)); }
      catch (e) { send(res, 200, { saved: false, rows: null }); }
    });
    return;
  }
  if (route === "/notes/pay-flag" && req.method === "POST") {
    readBody(req, function (raw) {
      if (raw.length > 40000) return send(res, 413, { error: "The table is too large." });
      var msg;
      try { msg = JSON.parse(raw || "{}"); }
      catch (e) { return send(res, 400, { error: "Request is not JSON." }); }
      var rows = msg && msg.rows;
      if (!Array.isArray(rows) || rows.length > 40) return send(res, 400, { error: "The table rows are not valid." });
      var clean = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        var cells = row.cells;
        if (!Array.isArray(cells) || cells.length !== 5) return send(res, 400, { error: "Each row needs five cells." });
        var stored = [];
        for (var c = 0; c < cells.length; c++) {
          var text = cells[c] == null ? "" : String(cells[c]);
          if (text.length > 500) return send(res, 400, { error: "A cell is too long." });
          stored.push(text);
        }
        var hit = row.hit == null ? "" : String(row.hit);
        if (hit.length > 40) return send(res, 400, { error: "A row mark is too long." });
        clean.push({ hit: hit, obsolete: row.obsolete === true, cells: stored });
      }
      var dir = path.join(ROOT, "notes");
      fs.mkdir(dir, function () {
        var body = JSON.stringify({ saved: true, rows: clean }, null, 2);
        fs.writeFile(path.join(dir, "pay-flag.json"), body, "utf8", function (err) {
          if (err) return send(res, 500, { error: "The table could not be saved." });
          send(res, 200, { saved: true, rows: clean.length });
        });
      });
    });
    return;
  }
  if (route === "/health" && req.method === "POST") {
    readBody(req, function (raw) {
      if (raw.length > 8000) return send(res, 413, { error: "The request is too large." });
      var msg;
      try { msg = JSON.parse(raw || "{}"); }
      catch (e) { return send(res, 400, { error: "Request is not JSON." }); }
      healthDb.run(msg, function (status, body) { send(res, status, body); }, res);
    });
    return;
  }
  serveFile(req, res);
});

server.listen(PORT, "127.0.0.1", function () {
  console.log("Regression runner at http://127.0.0.1:" + PORT + "/");
});

function forward(msg, res) {
  var target;
  try { target = new URL(msg.url); }
  catch (e) { return send(res, 400, { error: "The address is not a URL." }); }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return send(res, 400, { error: "Only http and https addresses can be called." });
  }
  var pathName = target.pathname.toLowerCase();
  for (var i = 0; i < WRITE.length; i++) {
    if (pathName.indexOf(WRITE[i]) >= 0) {
      return send(res, 403, { error: "This page does not send a call that writes." });
    }
  }
  var lib = target.protocol === "https:" ? https : http;
  var body = JSON.stringify(msg.body == null ? {} : msg.body);
  var out = lib.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: msg.method || "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    },
    timeout: 20000
  }, function (up) {
    var chunks = [];
    up.on("data", function (c) { chunks.push(c); });
    up.on("end", function () {
      send(res, 200, { status: up.statusCode, body: Buffer.concat(chunks).toString("utf8") });
    });
  });
  out.on("timeout", function () { out.destroy(new Error("The host did not answer in time.")); });
  out.on("error", function (err) {
    send(res, 502, { error: "The runner could not reach the host. " + err.message });
  });
  out.end(body);
}

function serveFile(req, res) {
  var name = decodeURIComponent(req.url.split("?")[0]);
  if (name === "/") name = "index.html";
  else name = name.replace(/^[/\\]+/, "");
  var file = path.resolve(ROOT, name);
  if (file !== ROOT && file.indexOf(ROOT + path.sep) !== 0) {
    res.writeHead(403);
    res.end("no");
    return;
  }
  fs.readFile(file, function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" });
    res.end(data);
  });
}

function readBody(req, done) {
  var chunks = [];
  req.on("data", function (c) { chunks.push(c); });
  req.on("end", function () { done(Buffer.concat(chunks).toString("utf8")); });
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

function send(res, status, obj) {
  var text = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(text);
}
