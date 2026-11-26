var fs = require("fs");
var http = require("http");
var https = require("https");
var path = require("path");

var CALL_MS = 12000;

function proxyFromNpmrc() {
  var home = process.env.USERPROFILE || process.env.HOME || "";
  if (!home) return "";
  var text = "";
  try { text = fs.readFileSync(path.join(home, ".npmrc"), "utf8"); }
  catch (e) { return ""; }
  var line = text.split(/\r?\n/).map(function (item) { return item.trim(); }).filter(function (item) {
    return /^proxy=/i.test(item);
  })[0];
  if (!line) return "";
  return line.slice(line.indexOf("=") + 1).trim();
}

function soapParams(source, json) {
  var body = json || {};
  var userId = text(body.userId) || "FCS_USER";
  var kind = String(source || "");
  if (/doCallSpec_findSpecialty|findSpecialty/i.test(kind) && !/OpasUnit|SubSpec|Eis/i.test(kind)) {
    return { hospital: text(body.hospitalCode), specialty: "", opasUnit: "", userId: userId };
  }
  if (/findOpasUnit|doCallSubSpec|doCallEis/i.test(kind)) {
    var spec = text(body.specialty);
    if (!spec && body.specialtyList && body.specialtyList.length) spec = text(body.specialtyList[0]);
    return { hospital: text(body.hospitalCode), specialty: spec, opasUnit: text(body.opasUnit), userId: userId };
  }
  var patient = /PATIENT/i.test(kind);
  var mam = /MAM/i.test(kind);
  var caseNo = text(body.caseNo);
  if (patient && caseNo.indexOf("FC0") === 0) caseNo = "";
  var patientNo = text(body.patientKey || body.patientNo);
  if (patientNo === "0") patientNo = "";
  return {
    hospital: text(body.hospitalCode),
    hkid: mam ? "" : text(body.hkid),
    caseNo: caseNo,
    apptSeq: body.apptSeq == null || body.apptSeq === "" ? (mam ? "0" : "") : String(body.apptSeq),
    duration: mam ? "0" : (body.duration == null || body.duration === "" ? (patient ? "7" : "") : String(body.duration)),
    withPatient: /ATTENDANCE/i.test(kind) ? "N" : "Y",
    patientNo: patientNo,
    userId: userId
  };
}

function envelope(mapping, params) {
  var ns = text(mapping.TARGET_NAMESPACE);
  var prefix = text(mapping.TARGET_NAMESPACE_PREFIX);
  var method = text(mapping.WEB_METHOD);
  var methodTag = prefix ? prefix + ":" + method : method;
  var nsDecl = prefix ? " xmlns:" + prefix + "=\"" + xml(ns) + "\"" : "";
  var children = Object.keys(params).map(function (key) {
    return "<" + key + ">" + xml(params[key]) + "</" + key + ">";
  }).join("");
  return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
    "<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\"" + nsDecl + ">" +
    "<soapenv:Header><wsse:Security xmlns:wsse=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd\">" +
    "<wsse:UsernameToken xmlns:wsu=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd\">" +
    "<wsse:Username>" + xml(mapping.USERNAME) + "</wsse:Username>" +
    "<wsse:Password Type=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText\">" + xml(mapping.PASSWORD) + "</wsse:Password>" +
    "</wsse:UsernameToken></wsse:Security></soapenv:Header>" +
    "<soapenv:Body><" + methodTag + ">" + children + "</" + methodTag + "></soapenv:Body></soapenv:Envelope>";
}

function callOld(mapping, source, requestJson) {
  var endpoint = text(mapping && mapping.ENDPOINT_URL);
  var target;
  try { target = new URL(endpoint); }
  catch (e) { return Promise.reject(new Error("The old endpoint address on WS_KEY_MAPPING is not a URL.")); }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return Promise.reject(new Error("The old endpoint address is not http or https."));
  }
  var params = soapParams(source, requestJson);
  var body = envelope(mapping, params);
  var ns = text(mapping.TARGET_NAMESPACE);
  var action = ns + text(mapping.WEB_METHOD);
  var headers = {
    "Content-Type": "text/xml; charset=utf-8",
    "SOAPAction": "\"" + action + "\"",
    "Content-Length": Buffer.byteLength(body)
  };
  return send(target, headers, body).then(function (result) {
    return {
      status: result.status,
      body: result.body,
      path: target.pathname + target.search,
      params: params
    };
  });
}

function send(target, headers, body) {
  var proxy = proxyFromNpmrc();
  if (!proxy || target.protocol === "http:") return direct(target, headers, body);
  return tunneled(proxy, target, headers, body);
}

function direct(target, headers, body) {
  var lib = target.protocol === "https:" ? https : http;
  return new Promise(function (resolve, reject) {
    var req = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: "POST",
      headers: headers,
      timeout: CALL_MS
    }, function (res) { collect(res, resolve); });
    req.on("timeout", function () { req.destroy(new Error("The old endpoint did not answer within 12 seconds.")); });
    req.on("error", function (err) { reject(clean(err)); });
    req.end(body);
  });
}

function tunneled(proxy, target, headers, body) {
  var gate;
  try { gate = new URL(proxy); }
  catch (e) { return direct(target, headers, body); }
  return new Promise(function (resolve, reject) {
    var auth = {};
    if (gate.username) {
      auth["Proxy-Authorization"] = "Basic " + Buffer.from(decodeURIComponent(gate.username) + ":" + decodeURIComponent(gate.password || "")).toString("base64");
    }
    var conn = http.request({
      host: gate.hostname,
      port: gate.port || 80,
      method: "CONNECT",
      path: target.hostname + ":" + (target.port || 443),
      headers: auth,
      timeout: CALL_MS
    });
    conn.on("connect", function (res, socket) {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error("The proxy did not open the old endpoint."));
        return;
      }
      var req = https.request({
        host: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: "POST",
        headers: headers,
        socket: socket,
        agent: false,
        timeout: CALL_MS
      }, function (up) { collect(up, resolve); });
      req.on("timeout", function () { req.destroy(new Error("The old endpoint did not answer within 12 seconds.")); });
      req.on("error", function (err) { reject(clean(err)); });
      req.end(body);
    });
    conn.on("timeout", function () { conn.destroy(new Error("The proxy did not answer within 12 seconds.")); });
    conn.on("error", function (err) { reject(clean(err)); });
    conn.end();
  });
}

function collect(res, resolve) {
  var chunks = [];
  var size = 0;
  res.on("data", function (chunk) {
    size += chunk.length;
    if (size <= 200000) chunks.push(chunk);
  });
  res.on("end", function () {
    resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
  });
}

function text(value) {
  return value == null ? "" : String(value);
}

function xml(value) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clean(err) {
  var message = String(err && err.message || "The old endpoint did not answer.");
  message = message.replace(/https?:\/\/\S+/gi, "the old endpoint");
  message = message.replace(/password[=:]\s*\S+/ig, "password");
  if (message.length > 240) message = message.slice(0, 240);
  return new Error(message);
}

module.exports = { callOld: callOld, soapParams: soapParams };
