var CP850 = [
  0x00C7, 0x00FC, 0x00E9, 0x00E2, 0x00E4, 0x00E0, 0x00E5, 0x00E7, 0x00EA, 0x00EB, 0x00E8, 0x00EF, 0x00EE, 0x00EC, 0x00C4, 0x00C5,
  0x00C9, 0x00E6, 0x00C6, 0x00F4, 0x00F6, 0x00F2, 0x00FB, 0x00F9, 0x00FF, 0x00D6, 0x00DC, 0x00F8, 0x00A3, 0x00D8, 0x00D7, 0x0192,
  0x00E1, 0x00ED, 0x00F3, 0x00FA, 0x00F1, 0x00D1, 0x00AA, 0x00BA, 0x00BF, 0x00AE, 0x00AC, 0x00BD, 0x00BC, 0x00A1, 0x00AB, 0x00BB,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x00C1, 0x00C2, 0x00C0, 0x00A9, 0x2563, 0x2551, 0x2557, 0x255D, 0x00A2, 0x00A5, 0x2510,
  0x2514, 0x2534, 0x252C, 0x251C, 0x2500, 0x253C, 0x00E3, 0x00C3, 0x255A, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256C, 0x00A4,
  0x00F0, 0x00D0, 0x00CA, 0x00CB, 0x00C8, 0x0131, 0x00CD, 0x00CE, 0x00CF, 0x2518, 0x250C, 0x2588, 0x2584, 0x00A6, 0x00CC, 0x2580,
  0x00D3, 0x00DF, 0x00D4, 0x00D2, 0x00F5, 0x00D5, 0x00B5, 0x00FE, 0x00DE, 0x00DA, 0x00DB, 0x00D9, 0x00FD, 0x00DD, 0x00AF, 0x00B4,
  0x00AD, 0x00B1, 0x2017, 0x00BE, 0x00B6, 0x00A7, 0x00F7, 0x00B8, 0x00B0, 0x00A8, 0x00B7, 0x00B9, 0x00B3, 0x00B2, 0x25A0, 0x00A0
];

var CP850_BYTE = {};
CP850.forEach(function (code, i) { CP850_BYTE[code] = 0x80 + i; });

function undoCp850(text) {
  var src = String(text || "");
  if (!src) return "";
  var bytes = [];
  for (var i = 0; i < src.length; i++) {
    var code = src.charCodeAt(i);
    if (code < 128) bytes.push(code);
    else if (CP850_BYTE[code] != null) bytes.push(CP850_BYTE[code]);
    else return src;
  }
  return Buffer.from(bytes).toString("utf8");
}

function parseJson(text) {
  var raw = String(text || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (e) { /* the API log is stored with each UTF-8 byte read as CP850 */ }
  try { return JSON.parse(undoCp850(raw)); }
  catch (e2) { return null; }
}

function xmlBlocks(xml, tag) {
  var re = new RegExp("<(?:[\\w.-]+:)?" + tag + "\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?" + tag + ">", "gi");
  var out = [];
  var match;
  while ((match = re.exec(xml))) out.push(match[1]);
  return out;
}

function xmlValue(block, tag) {
  var blocks = xmlBlocks(block, tag);
  if (!blocks.length) return "";
  return decodeXml(blocks[0].replace(/<[^>]+>/g, "").trim());
}

function decodeXml(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textOf(value) {
  if (value == null) return "";
  return String(value).trim();
}

function pick(obj, names) {
  if (!obj) return "";
  for (var i = 0; i < names.length; i++) {
    if (obj[names[i]] != null && obj[names[i]] !== "") return obj[names[i]];
  }
  return "";
}

function timestampString(value) {
  var text = textOf(value);
  if (!text) return "";
  if (/^(1|2)\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(text)) return text + " 00:00:00.0";
  if (/^(1|2)\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ((0|1)\d|2[0-3])(:[0-5]\d){2}$/.test(text)) return text + ".0";
  if (/^(1|2)\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T((0|1)\d|2[0-3])(:[0-5]\d){2}$/.test(text)) return text.replace("T", " ") + ".0";
  if (/^(1|2)\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T((0|1)\d|2[0-3])(:[0-5]\d){2}\.\d{1,6}$/.test(text)) return text.replace("T", " ");
  if (/^(1|2)\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ((0|1)\d|2[0-3])(:[0-5]\d){2}\.\d{1,6}$/.test(text)) return text;
  return text;
}

function sameValue(field, left, right) {
  var a = textOf(left);
  var b = textOf(right);
  if (a === b) return true;
  if (/amount|percentage|seq|patientno|patientkey|cccode/i.test(field)) {
    if (a !== "" && b !== "" && !isNaN(Number(a)) && !isNaN(Number(b)) && Number(a) === Number(b)) return true;
  }
  var da = timestampString(a);
  var db = timestampString(b);
  if (da && db && da === db) return true;
  return false;
}

function line(field, oldVal, rawVal, mappedVal, handledReason, intentional, storedOld) {
  var oldText = textOf(oldVal);
  var rawText = textOf(rawVal);
  var mappedText = textOf(mappedVal);
  var compareOld = storedOld == null ? oldText : textOf(storedOld);
  var mappedSame = sameValue(field, compareOld, mappedText);
  var rawSame = rawText === "" || sameValue(field, rawText, mappedText);
  var code = "Differs";
  var reason = "";
  if (mappedSame && rawSame && compareOld === oldText) code = "Same";
  else if (mappedSame) {
    code = "Handled";
    reason = handledReason || "The new path reads a different JSON name into this field.";
  } else if (intentional && handledReason) {
    code = "Handled";
    reason = handledReason;
  }
  var impact = impactFor(field, code);
  return {
    field: field,
    old: oldText,
    raw: rawText,
    mapped: mappedText,
    code: code,
    reason: reason,
    impact: impact.name,
    impactWhy: impact.why
  };
}

function impactFor(field, code) {
  if (code === "Same" || code === "Handled") {
    return { name: "None", why: "Payment stores the same result, or this path does not use the field." };
  }
  var key = String(field || "").replace(/^patient\./, "");
  var role = FIELD_IMPACT[key] || FIELD_IMPACT[key.toLowerCase()];
  if (!role && /^CCCode[1-6]$/i.test(key)) role = FIELD_IMPACT.CCCode1;
  if (!role) {
    return { name: "Review", why: "This field is not in the known payment mapping. Check it before the next hospital." };
  }
  return role;
}

var FIELD_IMPACT = {
  payCode: { name: "Charge", why: "Stored as the OPAS pay code. With the pay flag, it selects the charge rate." },
  opasPayCode: { name: "Charge", why: "Read into the pay code, which selects the charge rate." },
  payFlag: { name: "Charge", why: "Stored as the OPAS pay flag. With the pay code, it selects the charge rate." },
  opasPayFlag: { name: "Charge", why: "Read into the pay flag, which selects the charge rate." },
  drugCharge: { name: "Charge", why: "The EIS path stores this as the pay flag." },
  chargeAmount: { name: "Charge", why: "Stored as the OPAS charge amount on the payment." },
  journalAmount: { name: "Charge", why: "Stored as the OPAS payment amount on the payment." },
  chargeCode: { name: "Charge", why: "Stored as the OPAS charge code on the payment." },
  waiverPercentage: { name: "Charge", why: "Stored as the waiver percent on the payment." },
  waiverEffDate: { name: "Charge", why: "Stored as the waiver effective date on the payment." },
  waiverExpDate: { name: "Charge", why: "Stored as the waiver expiry date on the payment." },
  waiverRefNo: { name: "Charge", why: "Stored as the waiver reference on the payment." },
  newWaiverType: { name: "Charge", why: "Stored as the waiver type on the payment." },
  specialty: { name: "Charge", why: "Stored as the OPAS specialty on the payment." },
  subSpecialty: { name: "Charge", why: "Stored as the OPAS unit on the payment." },
  opasUnit: { name: "Charge", why: "Read into the OPAS unit on the payment." },
  eisServiceType: { name: "Charge", why: "Stored on the payment from the EIS result. The sub-specialty path blanks it on purpose." },
  eisSpecialty: { name: "Charge", why: "Stored on the payment from the specialty or EIS result." },
  eisSubSpecialty: { name: "Charge", why: "Stored on the payment from the EIS result. The sub-specialty path blanks it on purpose." },
  imisSpecialty: { name: "Charge", why: "Read into eisSpecialty on the specialty path." },
  apptSeq: { name: "Visit", why: "Stored as the OPAS appointment sequence. A difference attaches the payment to another visit." },
  caseNo: { name: "Visit", why: "Stored as the OPAS case number. A difference attaches the payment to another case." },
  patientNo: { name: "Visit", why: "Stored as the patient key. A difference attaches the payment to another patient." },
  patientKey: { name: "Visit", why: "Stored as the patient key. A difference attaches the payment to another patient." },
  hkid: { name: "Visit", why: "Stored as the patient HKID." },
  HKID: { name: "Visit", why: "Stored as the patient HKID." },
  slotDatetime: { name: "Visit", why: "Stored as the appointment slot time." },
  journalDatetime: { name: "Visit", why: "Stored as the OPAS payment time." },
  patientName: { name: "Screen", why: "Stored as the English name on the payment screen. It does not select the charge rate." },
  chineseName: { name: "Screen", why: "Stored as the Chinese name, rebuilt from the CC codes when those codes exist. It does not select the charge rate." },
  sex: { name: "Screen", why: "Stored as the patient sex on the payment screen. It does not select the charge rate." },
  DOB: { name: "Screen", why: "Stored as the patient date of birth. It does not select the charge rate." },
  dob: { name: "Screen", why: "Stored as the patient date of birth. It does not select the charge rate." },
  exactDOBFlag: { name: "Screen", why: "Stored on the patient and passed into the payment procedure. It does not select the charge rate." },
  exactdobFlag: { name: "Screen", why: "Stored on the attendance row. It does not select the charge rate." },
  exactDobFlag: { name: "Screen", why: "Read into the exact-DOB flag. It does not select the charge rate." },
  CCCode1: { name: "Screen", why: "Stored as a CC code and used to rebuild the Chinese name. A code of 0 is not a character. It does not select the charge rate." },
  specialtyDescription: { name: "Screen", why: "Specialty description shown with the row. The charge uses the specialty code." },
  description: { name: "Screen", why: "Read into the specialty description. The charge uses the specialty code." },
  opasUnitDescription: { name: "Screen", why: "Unit description shown with the row. The charge uses the unit code." },
  receiptNo: { name: "Record", why: "Stored as the OPAS receipt number. It does not select the charge rate." },
  paymentMeans: { name: "Record", why: "Stored as the OPAS payment means. It does not select the charge rate." },
  shroffGroup: { name: "Record", why: "Stored as the shroff group. It does not select the charge rate." },
  additionNepKey1: { name: "Record", why: "Stored as an NEP key. It does not select the charge rate." },
  additionNepKey2: { name: "Record", why: "Stored as an NEP key. It does not select the charge rate." },
  nepSearchKey: { name: "Record", why: "Stored as the NEP search key. It does not select the charge rate." },
  updSys: { name: "Record", why: "Stored as the update system. It does not select the charge rate." },
  chargeGroup: { name: "Record", why: "The new attendance parser stores it. The old SOAP attendance reader does not. It is not the pay code." }
};

function waiverDate(value) {
  var text = timestampString(value);
  return text || "1900-01-01 00:00:00.0";
}

function rounded(value) {
  var text = textOf(value);
  if (text === "" || isNaN(Number(text))) return text;
  return String(Math.round(Number(text)));
}

function cccode(patient, index) {
  var unicode = pick(patient, ["unicodeInt" + index, "unicode_int" + index]);
  if (unicode !== "" && !isNaN(Number(unicode)) && Number(unicode) > 0) return String(unicode);
  return textOf(pick(patient, ["cccode" + index, "CCCode" + index]));
}

function ncrsName(codes) {
  var out = "";
  codes.forEach(function (code) {
    if (code && code !== "0") out += "&#" + code + ";";
  });
  return out;
}

function listOf(json, names) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  for (var i = 0; i < names.length; i++) {
    if (Array.isArray(json[names[i]])) return json[names[i]];
  }
  return [];
}

function compareAttendance(oldXml, json, request) {
  var oldRows = xmlBlocks(oldXml, "appointment").map(function (block) {
    return {
      apptSeq: xmlValue(block, "apptSeq"),
      caseNo: xmlValue(block, "caseNo"),
      chargeAmount: xmlValue(block, "chargeAmount"),
      chargeCode: xmlValue(block, "chargeCode"),
      eisServiceType: xmlValue(block, "eisServiceType"),
      eisSpecialty: xmlValue(block, "eisSpecialty"),
      eisSubSpecialty: xmlValue(block, "eisSubSpecialty"),
      journalAmount: xmlValue(block, "journalAmount"),
      journalDatetime: xmlValue(block, "journalDatetime"),
      patientNo: xmlValue(block, "patientNo"),
      payCode: xmlValue(block, "payCode"),
      payFlag: xmlValue(block, "payFlag"),
      paymentMeans: xmlValue(block, "paymentMeans"),
      shroffGroup: xmlValue(block, "shroffGroup"),
      slotDatetime: xmlValue(block, "slotDatetime"),
      specialty: xmlValue(block, "specialty"),
      subSpecialty: xmlValue(block, "subSpecialty"),
      waiverEffDate: xmlValue(block, "waiverEffDate"),
      waiverExpDate: xmlValue(block, "waiverExpDate"),
      waiverPercentage: xmlValue(block, "waiverPercentage"),
      waiverRefNo: xmlValue(block, "waiverRefNo"),
      additionNepKey1: xmlValue(block, "additionNepKey1"),
      additionNepKey2: xmlValue(block, "additionNepKey2"),
      nepSearchKey: xmlValue(block, "nepSearchKey"),
      hkid: xmlValue(block, "hkid"),
      dob: xmlValue(block, "dob"),
      exactdobFlag: xmlValue(block, "exactdobFlag"),
      receiptNo: xmlValue(block, "receiptNo"),
      newWaiverType: xmlValue(block, "newWaiverType"),
      updSys: xmlValue(block, "updSys"),
      chargeGroup: xmlValue(block, "chargeGroup")
    };
  });
  var patient = json && json.patient || {};
  var appointments = listOf(json, ["appointments"]);
  var requestCase = textOf(request && request.caseNo);
  var requestHkid = textOf(request && request.hkid);
  var patientKey = textOf(pick(patient, ["patientKey"]));
  var patientHkid = textOf(pick(patient, ["hkid"])) || requestHkid;
  var groups = [];
  var used = {};
  appointments.slice(0, 8).forEach(function (appt, index) {
    var seq = textOf(pick(appt, ["apptSeq"]));
    var old = null;
    for (var i = 0; i < oldRows.length; i++) {
      if (used[i]) continue;
      if (seq && textOf(oldRows[i].apptSeq) === seq) { old = oldRows[i]; used[i] = true; break; }
    }
    if (!old && oldRows[index] && !used[index]) { old = oldRows[index]; used[index] = true; }
    old = old || {};
    var caseNo = textOf(pick(appt, ["caseNo"])) || requestCase;
    var rows = [
      line("apptSeq", old.apptSeq, seq, seq, ""),
      line("caseNo", old.caseNo, pick(appt, ["caseNo"]), caseNo, "A blank case number on the new response is filled from the request.", true),
      line("chargeAmount", old.chargeAmount, pick(appt, ["chargeAmount"]), pick(appt, ["chargeAmount"]), ""),
      line("chargeCode", old.chargeCode, pick(appt, ["chargeCode"]), pick(appt, ["chargeCode"]), ""),
      line("eisServiceType", old.eisServiceType, pick(appt, ["eisServiceType"]), pick(appt, ["eisServiceType"]), ""),
      line("eisSpecialty", old.eisSpecialty, pick(appt, ["eisSpecialty"]), pick(appt, ["eisSpecialty"]), ""),
      line("eisSubSpecialty", old.eisSubSpecialty, pick(appt, ["eisSubSpecialty"]), pick(appt, ["eisSubSpecialty"]), ""),
      line("journalAmount", old.journalAmount, pick(appt, ["journalAmount"]), pick(appt, ["journalAmount"]), ""),
      line("journalDatetime", old.journalDatetime, pick(appt, ["journalDatetime"]), timestampString(pick(appt, ["journalDatetime"])), ""),
      line("patientNo", old.patientNo, pick(appt, ["patientNo", "patientKey"]), patientKey, "patientNo is taken from patient.patientKey, not from the appointment row."),
      line("payCode", old.payCode, pick(appt, ["payCode", "opasPayCode"]), pick(appt, ["opasPayCode", "payCode"]), "payCode is read from opasPayCode."),
      line("payFlag", old.payFlag, pick(appt, ["payFlag", "opasPayFlag"]), pick(appt, ["opasPayFlag", "payFlag"]), "payFlag is read from opasPayFlag."),
      line("paymentMeans", old.paymentMeans, pick(appt, ["paymentMeans"]), pick(appt, ["paymentMeans"]), ""),
      line("shroffGroup", old.shroffGroup, pick(appt, ["shroffGroup"]), pick(appt, ["shroffGroup"]), ""),
      line("slotDatetime", old.slotDatetime, pick(appt, ["slotDatetime"]), timestampString(pick(appt, ["slotDatetime"])), ""),
      line("specialty", old.specialty, pick(appt, ["specialty"]), pick(appt, ["specialty"]), ""),
      line("subSpecialty", old.subSpecialty, pick(appt, ["subSpecialty", "opasUnit"]), pick(appt, ["opasUnit", "subSpecialty"]), "subSpecialty is read from opasUnit."),
      line("waiverEffDate", old.waiverEffDate, pick(appt, ["waiverEffDate"]), waiverDate(pick(appt, ["waiverEffDate"])), "A blank waiver effective date is stored as 1900-01-01.", true),
      line("waiverExpDate", old.waiverExpDate, pick(appt, ["waiverExpDate"]), waiverDate(pick(appt, ["waiverExpDate"])), "A blank waiver expiry date is stored as 1900-01-01.", true),
      line("waiverPercentage", old.waiverPercentage, pick(appt, ["waiverPercentage"]), rounded(pick(appt, ["waiverPercentage"])), "waiverPercentage is rounded to an integer.", true),
      line("waiverRefNo", old.waiverRefNo, pick(appt, ["waiverRefNo"]), pick(appt, ["waiverRefNo"]), ""),
      line("additionNepKey1", old.additionNepKey1, pick(appt, ["additionNepKey1"]), pick(appt, ["additionNepKey1"]), ""),
      line("additionNepKey2", old.additionNepKey2, pick(appt, ["additionNepKey2"]), pick(appt, ["additionNepKey2"]), ""),
      line("nepSearchKey", old.nepSearchKey, pick(appt, ["nepSearchKey"]), pick(appt, ["nepSearchKey"]), ""),
      line("hkid", old.hkid, pick(appt, ["hkid"]), patientHkid, "hkid is taken from the patient object."),
      line("dob", old.dob, pick(appt, ["dob"]), timestampString(pick(appt, ["dob"])), ""),
      line("exactdobFlag", old.exactdobFlag, pick(appt, ["exactdobFlag", "exactDobFlag"]), pick(appt, ["exactDobFlag", "exactdobFlag"]), "exactdobFlag is read from exactDobFlag."),
      line("receiptNo", old.receiptNo, pick(appt, ["receiptNo"]), pick(appt, ["receiptNo"]), ""),
      line("newWaiverType", old.newWaiverType, pick(appt, ["newWaiverType"]), pick(appt, ["newWaiverType"]), ""),
      line("updSys", old.updSys, pick(appt, ["updSys"]), pick(appt, ["updSys"]), ""),
      line("chargeGroup", old.chargeGroup, pick(appt, ["chargeGroup"]), pick(appt, ["chargeGroup"]), "The old SOAP attendance reader does not take chargeGroup.", old.chargeGroup == null || textOf(old.chargeGroup) === "")
    ];
    groups.push({ title: "Appointment " + (seq || String(index + 1)), rows: rows });
  });
  if (!appointments.length && oldRows.length) {
    groups.push({ title: "Appointment", rows: [line("appointments", String(oldRows.length), "", "0", "")] });
  }
  return groups;
}

function comparePatient(oldXml, json) {
  var patient = json && json.patient || {};
  var codes = [1, 2, 3, 4, 5, 6].map(function (n) { return cccode(patient, n); });
  var rebuilt = ncrsName(codes);
  var oldChinese = xmlValue(oldXml, "chineseName");
  var chineseMapped = rebuilt.indexOf("&#") === 0 ? rebuilt : textOf(pick(patient, ["chineseName"]));
  var dobRaw = pick(patient, ["dob", "DOB"]);
  var dobMapped = timestampString(dobRaw);
  dobMapped = dobMapped ? dobMapped.slice(0, 10) + " 00:00:00.0" : "";
  var dobOld = xmlValue(oldXml, "DOB");
  var dobDateHandled = dobMapped && dobOld && dobMapped.slice(0, 10) === timestampString(dobOld).slice(0, 10) && !sameValue("DOB", dobOld, dobMapped);
  var rows = [
    line("patientKey", xmlValue(oldXml, "patientKey"), pick(patient, ["patientKey"]), pick(patient, ["patientKey"]), ""),
    line("HKID", xmlValue(oldXml, "HKID"), pick(patient, ["hkid", "HKID"]), pick(patient, ["hkid", "HKID"]), ""),
    line("patientName", xmlValue(oldXml, "patientName"), pick(patient, ["patientName"]), pick(patient, ["patientName"]), ""),
    line("sex", xmlValue(oldXml, "sex"), pick(patient, ["sex"]), pick(patient, ["sex"]), ""),
    line("DOB", dobOld, dobRaw, dobMapped, dobDateHandled ? "DOB is stored as the date with 00:00:00.0." : "", dobDateHandled),
    line("exactDOBFlag", xmlValue(oldXml, "exactDOBFlag"), pick(patient, ["exactDobFlag", "exactDOBFlag"]), pick(patient, ["exactDobFlag", "exactDOBFlag"]), "exactDOBFlag is read from exactDobFlag."),
    line("chineseName", oldChinese, pick(patient, ["chineseName"]), chineseMapped, "Chinese name is rebuilt from the CCC codes when those codes are present.", rebuilt.indexOf("&#") === 0)
  ];
  codes.forEach(function (code, index) {
    var n = index + 1;
    var rawCcc = pick(patient, ["cccode" + n, "CCCode" + n]);
    var unicode = pick(patient, ["unicodeInt" + n, "unicode_int" + n]);
    var rawShown = unicode && rawCcc && String(unicode) !== String(rawCcc) ? rawCcc : (unicode || rawCcc);
    rows.push(line("CCCode" + n, xmlValue(oldXml, "CCCode" + n), rawShown, code, "CCCode is taken from unicodeInt when that value is above zero."));
  });
  return [{ title: "Patient", rows: rows }];
}

function soapInfoRows(xml) {
  var blocks = xmlBlocks(xml, "fcsopasinfo");
  if (!blocks.length) blocks = xmlBlocks(xml, "appointment");
  return blocks.map(function (block) {
    return {
      specialty: xmlValue(block, "specialty"),
      specialtyDescription: xmlValue(block, "specialtyDescription"),
      eisSpecialty: xmlValue(block, "eisSpecialty"),
      eisServiceType: xmlValue(block, "eisServiceType"),
      eisSubSpecialty: xmlValue(block, "eisSubSpecialty"),
      opasUnit: xmlValue(block, "opasUnit"),
      opasUnitDescription: xmlValue(block, "opasUnitDescription"),
      opasPayFlag: xmlValue(block, "opasPayFlag"),
      chargeGroup: xmlValue(block, "chargeGroup"),
      hospital: xmlValue(block, "hospital")
    };
  });
}

function compareSpec(oldXml, json) {
  var items = listOf(json, ["content", "data", "specialties"]);
  var oldRows = soapInfoRows(oldXml);
  var groups = [];
  items.slice(0, 25).forEach(function (item) {
    var specialty = textOf(pick(item, ["specialty"]));
    var old = null;
    for (var i = 0; i < oldRows.length; i++) {
      if (textOf(oldRows[i].specialty) === specialty) { old = oldRows[i]; break; }
    }
    old = old || {};
    groups.push({
      title: "Specialty " + (specialty || "?"),
      rows: [
        line("specialty", old.specialty, specialty, specialty, ""),
        line("specialtyDescription", old.specialtyDescription, pick(item, ["description", "specialtyDescription"]), pick(item, ["description", "specialtyDescription"]), "specialtyDescription is read from description."),
        line("eisSpecialty", old.eisSpecialty, pick(item, ["imisSpecialty", "eisSpecialty"]), pick(item, ["imisSpecialty", "eisSpecialty"]), "eisSpecialty is read from imisSpecialty.")
      ]
    });
  });
  return groups;
}

function compareSubSpec(oldXml, json) {
  var items = listOf(json, ["content", "data", "specialties"]);
  var oldRows = soapInfoRows(oldXml);
  var groups = [];
  items.slice(0, 25).forEach(function (item) {
    var unit = textOf(pick(item, ["opasUnit"]));
    var old = null;
    for (var i = 0; i < oldRows.length; i++) {
      if (textOf(oldRows[i].opasUnit) === unit) { old = oldRows[i]; break; }
    }
    old = old || {};
    var blank = "The new sub-spec parser writes this field as blank.";
    groups.push({
      title: "OPAS unit " + (unit || "?"),
      rows: [
        line("opasUnit", old.opasUnit, unit, unit, ""),
        line("opasUnitDescription", old.opasUnitDescription, pick(item, ["opasUnitDescription"]), pick(item, ["opasUnitDescription"]), ""),
        line("specialty", old.specialty, pick(item, ["specialty", "spec"]), pick(item, ["specialty", "spec"]), ""),
        line("chargeGroup", old.chargeGroup, pick(item, ["chargeGroup"]), pick(item, ["chargeGroup"]), ""),
        line("eisServiceType", old.eisServiceType, pick(item, ["eisServiceType"]), "", blank, true),
        line("eisSpecialty", old.eisSpecialty, pick(item, ["eisSpecialty"]), "", blank, true),
        line("eisSubSpecialty", old.eisSubSpecialty, pick(item, ["eisSubSpecialty"]), "", blank, true),
        line("opasPayFlag", old.opasPayFlag, pick(item, ["opasPayFlag"]), "", blank, true),
        line("specialtyDescription", old.specialtyDescription, pick(item, ["specialtyDescription", "description"]), "", blank, true)
      ]
    });
  });
  return groups;
}

function compareEis(oldXml, json, request) {
  var items = listOf(json, ["content", "data", "specialties"]);
  var wantSpec = textOf(request && (request.specialty || (request.specialtyList && request.specialtyList[0])));
  var wantUnit = textOf(request && request.opasUnit);
  var item = null;
  for (var i = 0; i < items.length; i++) {
    var spec = textOf(pick(items[i], ["specialty"]));
    var unit = textOf(pick(items[i], ["opasUnit"]));
    if (wantSpec && spec.toUpperCase() !== wantSpec.toUpperCase()) continue;
    if (wantUnit && unit.toUpperCase() !== wantUnit.toUpperCase()) continue;
    item = items[i];
    break;
  }
  item = item || {};
  var oldRows = soapInfoRows(oldXml);
  var old = oldRows[0] || {};
  for (var j = 0; j < oldRows.length; j++) {
    if (wantUnit && textOf(oldRows[j].opasUnit).toUpperCase() === wantUnit.toUpperCase()) { old = oldRows[j]; break; }
  }
  return [{
    title: "EIS " + (wantSpec || "") + " " + (wantUnit || ""),
    rows: [
      line("eisServiceType", old.eisServiceType, pick(item, ["eisServiceType"]), pick(item, ["eisServiceType"]), ""),
      line("eisSpecialty", old.eisSpecialty, pick(item, ["eisSpecialty"]), pick(item, ["eisSpecialty"]), ""),
      line("eisSubSpecialty", old.eisSubSpecialty, pick(item, ["eisSubSpecialty"]), pick(item, ["eisSubSpecialty"]), ""),
      line("opasPayFlag", old.opasPayFlag, pick(item, ["opasPayFlag", "drugCharge"]), pick(item, ["drugCharge", "opasPayFlag"]), "opasPayFlag is read from drugCharge.")
    ]
  }];
}

function compare(source, oldXml, newText, requestText) {
  var json = parseJson(newText) || {};
  var request = parseJson(requestText) || {};
  var kind = String(source || request._logSource || "");
  var groups = [];
  if (/findSpecialty|doCallSpec/i.test(kind)) groups = compareSpec(oldXml, json);
  else if (/doCallSubSpec/i.test(kind)) groups = compareSubSpec(oldXml, json);
  else if (/doCallEis/i.test(kind)) groups = compareEis(oldXml, json, request);
  else if (/PATIENT/i.test(kind)) groups = comparePatient(oldXml, json);
  else groups = compareAttendance(oldXml, json, request);
  var counts = { Same: 0, Handled: 0, Differs: 0 };
  groups.forEach(function (group) {
    group.rows.forEach(function (row) { counts[row.code] = (counts[row.code] || 0) + 1; });
  });
  return { source: kind, groups: groups, counts: counts };
}

function compareFull(source, oldText, newText) {
  var kind = String(source || "");
  var oldDoc = String(oldText || "");
  var json = parseJson(newText) || {};
  if (!oldDoc.trim()) {
    var preview = jsonRecords(json).map(function (rec) {
      var rows = Object.keys(rec.leaves).map(function (name) {
        return { field: name, old: "", raw: rec.leaves[name], mapped: "", code: "", reason: "" };
      });
      Object.keys(rec.patient || {}).forEach(function (name) {
        rows.push({ field: "patient." + name, old: "", raw: rec.patient[name], mapped: "", code: "", reason: "" });
      });
      return { title: rec.title, rows: rows.slice(0, 80) };
    });
    if (!preview.length) preview = [{ title: "Response", rows: [] }];
    return { source: kind, groups: preview, counts: { Same: 0, Handled: 0, Differs: 0 } };
  }
  var pairs = pairRecords(oldDoc, json, kind);
  var groups = pairs.map(function (pair) {
    var rows = pair.patientRecord
      ? comparePatientRecord(pair.oldLeaves, pair.newLeaves)
      : compareLeaves(pair.oldLeaves, pair.newLeaves, pair.patientLeaves, kind);
    return { title: pair.title, rows: rows };
  });
  if (/PATIENT/i.test(kind)) {
    groups = groups.filter(function (group) { return group.title === "Patient"; });
  }
  if (!groups.length) groups = [{ title: "Response", rows: compareLeaves({}, jsonLeavesFlat(json), {}, kind) }];
  var counts = { Same: 0, Handled: 0, Differs: 0, Charge: 0, Visit: 0, Screen: 0, Record: 0, Review: 0 };
  groups.forEach(function (group) {
    group.rows.forEach(function (row) {
      counts[row.code] = (counts[row.code] || 0) + 1;
      if (row.code === "Differs" && counts[row.impact] != null) counts[row.impact] += 1;
    });
    group.rows = preferDiffs(group.rows);
  });
  return { source: kind, groups: groups, counts: counts };
}

function preferDiffs(rows) {
  var rank = { Charge: 0, Visit: 1, Review: 2, Record: 3, Screen: 4, None: 5 };
  var ordered = rows.slice().sort(function (a, b) {
    var ar = a.code === "Differs" ? (rank[a.impact] == null ? 2 : rank[a.impact]) : (a.code === "Handled" ? 6 : 7);
    var br = b.code === "Differs" ? (rank[b.impact] == null ? 2 : rank[b.impact]) : (b.code === "Handled" ? 6 : 7);
    return ar - br;
  });
  var keep = [];
  var same = 0;
  ordered.forEach(function (row) {
    if (row.code === "Same") {
      if (same >= 40) return;
      same += 1;
    }
    keep.push(row);
  });
  return keep;
}

function pairRecords(oldDoc, json, kind) {
  var oldRecs = xmlRecords(oldDoc);
  var newRecs = jsonRecords(json);
  if (!oldRecs.length && !newRecs.length) return [];
  var pairs = [];
  var used = {};
  newRecs.forEach(function (rec, index) {
    var old = null;
    var seq = textOf(rec.leaves.apptSeq);
    for (var i = 0; i < oldRecs.length; i++) {
      if (used[i]) continue;
      if (seq && textOf(oldRecs[i].leaves.apptSeq) === seq) { old = oldRecs[i]; used[i] = true; break; }
    }
    if (!old && oldRecs[index] && !used[index] && oldRecs[index].kind === rec.kind) {
      old = oldRecs[index];
      used[index] = true;
    }
    if ((rec.kind === "patient") || (old && old.kind === "patient")) {
      var flat = Object.keys(rec.leaves || {}).length ? rec.leaves : (rec.patient || {});
      pairs.push({ title: "Patient", patientRecord: true, oldLeaves: old ? old.leaves : {}, newLeaves: flat, patientLeaves: flat });
      return;
    }
    pairs.push({
      title: rec.title,
      oldLeaves: old ? old.leaves : {},
      newLeaves: rec.leaves,
      patientLeaves: rec.patient || {}
    });
  });
  var patientFlat = json && json.patient && typeof json.patient === "object" ? flatObject(json.patient) : {};
  oldRecs.forEach(function (rec, index) {
    if (used[index]) return;
    if (rec.kind === "patient") {
      pairs.push({ title: "Patient", patientRecord: true, oldLeaves: rec.leaves, newLeaves: patientFlat, patientLeaves: patientFlat });
      return;
    }
    pairs.push({ title: rec.title + " only on old", oldLeaves: rec.leaves, newLeaves: {}, patientLeaves: {} });
  });
  if (!pairs.length && /PATIENT/i.test(kind)) {
    pairs.push({ title: "Patient", oldLeaves: {}, newLeaves: {}, patientLeaves: {} });
  }
  return pairs;
}

function xmlRecords(xml) {
  var text = String(xml || "");
  if (!text.trim()) return [];
  var found = [];
  ["appointment", "fcsopasinfo", "patient"].forEach(function (tag) {
    xmlBlocks(text, tag).forEach(function (block, index) {
      found.push({ kind: tag === "fcsopasinfo" ? "unit" : tag, title: labelFor(tag, index, leavesIn(block)), leaves: leavesIn(block) });
    });
  });
  if (found.length) return found;
  var leaves = leavesIn(text);
  if (!Object.keys(leaves).length) return [];
  return [{ kind: "body", title: "Response", leaves: leaves }];
}

function labelFor(tag, index, leaves) {
  if (tag === "appointment") return "Appointment " + (textOf(leaves.apptSeq) || String(index + 1));
  if (tag === "fcsopasinfo") return "Record " + (textOf(leaves.opasUnit || leaves.specialty) || String(index + 1));
  if (tag === "patient") return "Patient";
  return "Response";
}

function leavesIn(block) {
  var out = {};
  var re = /<(?:[\w.-]+:)?([A-Za-z][\w.-]*)\b[^>]*>([^<]*)<\/(?:[\w.-]+:)?\1>/g;
  var match;
  while ((match = re.exec(block))) {
    if (out[match[1]] == null) out[match[1]] = decodeXml(match[2].trim());
  }
  return out;
}

function jsonRecords(json) {
  if (!json || typeof json !== "object") return [];
  var patient = json.patient && typeof json.patient === "object" ? flatObject(json.patient) : {};
  var lists = listOf(json, ["appointments", "content", "data", "specialties"]);
  if (!lists.length && Array.isArray(json)) lists = json;
  if (lists.length) {
    return lists.slice(0, 30).map(function (item, index) {
      var leaves = flatObject(item);
      var title = leaves.apptSeq ? "Appointment " + leaves.apptSeq : (leaves.opasUnit || leaves.specialty ? "Record " + (leaves.opasUnit || leaves.specialty) : "Record " + (index + 1));
      return { kind: leaves.apptSeq ? "appointment" : "unit", title: title, leaves: leaves, patient: patient };
    });
  }
  if (Object.keys(patient).length) return [{ kind: "patient", title: "Patient", leaves: {}, patient: patient }];
  var top = flatObject(json);
  delete top._logSource;
  if (!Object.keys(top).length) return [];
  return [{ kind: "body", title: "Response", leaves: top, patient: {} }];
}

function flatObject(node) {
  var out = {};
  if (!node || typeof node !== "object" || Array.isArray(node)) return out;
  Object.keys(node).forEach(function (key) {
    var value = node[key];
    if (value != null && typeof value === "object") return;
    out[key] = textOf(value);
  });
  return out;
}

function jsonLeavesFlat(json) {
  return flatObject(json);
}

function compareLeaves(oldLeaves, newLeaves, patientLeaves, kind) {
  var rows = [];
  var usedOld = {};
  var usedNew = {};
  var aliases = aliasRules(kind);
  aliases.forEach(function (rule) {
    var oldVal = oldLeaves[rule.old];
    var source = rule.fromPatient ? patientLeaves : newLeaves;
    var rawVal = source[rule.neu];
    if (oldVal == null && (rawVal == null || rawVal === "")) return;
    if (rule.unicode) {
      var unicode = source["unicodeInt" + rule.n];
      var ccc = source["cccode" + rule.n];
      if (unicode && Number(unicode) > 0) rawVal = ccc || unicode;
      else rawVal = ccc || unicode || "";
      var mapped = (unicode && Number(unicode) > 0) ? String(unicode) : textOf(ccc);
      if (oldVal == null) return;
      if (!mapped && !textOf(oldVal)) return;
      rows.push(line("CCCode" + rule.n, oldVal || "", rawVal || "", mapped, "CCCode is taken from unicodeInt when that value is above zero."));
      usedOld["CCCode" + rule.n] = true;
      usedNew["unicodeInt" + rule.n] = true;
      usedNew["cccode" + rule.n] = true;
      return;
    }
    if (oldVal == null) return;
    var mappedVal = rule.map ? rule.map(rawVal, oldVal) : rawVal;
    rows.push(line(rule.old, oldVal || "", rawVal || "", mappedVal || "", rule.reason, !!rule.intentional));
    usedOld[rule.old] = true;
    usedNew[rule.neu] = true;
  });
  Object.keys(oldLeaves).forEach(function (name) {
    if (usedOld[name]) return;
    if (newLeaves[name] != null) {
      rows.push(line(name, oldLeaves[name], newLeaves[name], newLeaves[name], ""));
      usedOld[name] = true;
      usedNew[name] = true;
      return;
    }
    var copied = codeReads(kind, name);
    rows.push(line(name, oldLeaves[name], "", "", copied ? "" : "The new path does not read this SOAP field.", !copied));
  });
  Object.keys(newLeaves).forEach(function (name) {
    if (usedNew[name]) return;
    if (name === "chargeGroup") {
      rows.push(line(name, "", newLeaves[name], newLeaves[name], "The old SOAP attendance reader does not take chargeGroup.", true));
      return;
    }
    var copied = jsonCopied(kind, name);
    rows.push(line(name, "", newLeaves[name], copied ? newLeaves[name] : "", copied ? "" : "The payment code does not copy this new-response field.", !copied));
  });
  return rows;
}

function comparePatientRecord(oldLeaves, patient) {
  var rows = [];
  var newCodes = [];
  var oldCodes = [];
  for (var n = 1; n <= 6; n++) {
    var unicode = fieldText(patient, ["unicodeInt" + n, "unicode_int" + n]);
    var cccode = fieldText(patient, ["cccode" + n, "CCCode" + n]);
    var mapped = unicode !== "" && !isNaN(Number(unicode)) && Number(unicode) > 0 ? unicode : (cccode === "0" ? "" : cccode);
    newCodes.push(mapped);
    oldCodes.push(textOf(oldLeaves["CCCode" + n]));
    var oldCode = textOf(oldLeaves["CCCode" + n]);
    if (!oldCode && !mapped && !unicode && !cccode) continue;
    rows.push(line("CCCode" + n, oldCode, unicode || cccode, mapped === "0" ? "" : mapped, "A CC code of 0 is not a character. The new parser uses unicodeInt only when it is above zero.", false, oldCode === "0" ? "" : oldCode));
  }
  var newStored = ncrsName(newCodes);
  var oldStored = ncrsName(oldCodes);
  if (newStored.indexOf("&#") !== 0) newStored = textOf(patient.chineseName);
  if (oldStored.indexOf("&#") !== 0) oldStored = textOf(oldLeaves.chineseName);
  rows.push(line("chineseName", oldLeaves.chineseName || "", patient.chineseName || "", newStored, "Chinese name is rebuilt from the CC codes as &#code; when those codes are present.", false, oldStored));
  rows.push(line("DOB", oldLeaves.DOB || oldLeaves.dob || "", patient.dob || "", dobStored(patient.dob), "DOB is stored as the date plus 00:00:00.0."));
  rows.push(line("exactDOBFlag", oldLeaves.exactDOBFlag || oldLeaves.exactdobFlag || "", patient.exactDobFlag || patient.exactDOBFlag || "", patient.exactDobFlag || patient.exactDOBFlag || "", "exactDOBFlag is read from exactDobFlag."));
  rows.push(line("HKID", oldLeaves.HKID || oldLeaves.hkid || "", patient.hkid || "", patient.hkid || "", ""));
  rows.push(line("patientKey", oldLeaves.patientKey || "", patient.patientKey || "", patient.patientKey || "", ""));
  rows.push(line("patientName", oldLeaves.patientName || "", patient.patientName || "", patient.patientName || "", ""));
  rows.push(line("sex", oldLeaves.sex || "", patient.sex || "", patient.sex || "", ""));
  ["HKICResidencyStatus", "scInd"].forEach(function (name) {
    if (!textOf(oldLeaves[name])) return;
    rows.push(line(name, oldLeaves[name], "", "", "The patient parser does not read this SOAP field.", true));
  });
  return rows;
}

function fieldText(obj, names) {
  if (!obj) return "";
  for (var i = 0; i < names.length; i++) {
    if (obj[names[i]] != null && obj[names[i]] !== "") return textOf(obj[names[i]]);
  }
  return "";
}

function dobStored(value) {
  var text = timestampString(value);
  var day = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return day ? day[1] + " 00:00:00.0" : text;
}

function aliasRules(kind) {
  var rules = [
    { old: "subSpecialty", neu: "opasUnit", reason: "subSpecialty is read from opasUnit." },
    { old: "payCode", neu: "opasPayCode", reason: "payCode is read from opasPayCode." },
    { old: "payFlag", neu: "opasPayFlag", reason: "payFlag is read from opasPayFlag." },
    { old: "exactdobFlag", neu: "exactDobFlag", reason: "exactdobFlag is read from exactDobFlag." },
    { old: "exactDOBFlag", neu: "exactDobFlag", reason: "exactDOBFlag is read from exactDobFlag." },
    { old: "specialtyDescription", neu: "description", reason: "specialtyDescription is read from description." },
    { old: "waiverEffDate", neu: "waiverEffDate", reason: "A blank waiver effective date is stored as 1900-01-01.", intentional: true, map: waiverDate },
    { old: "waiverExpDate", neu: "waiverExpDate", reason: "A blank waiver expiry date is stored as 1900-01-01.", intentional: true, map: waiverDate },
    { old: "waiverPercentage", neu: "waiverPercentage", reason: "waiverPercentage is rounded to an integer.", intentional: true, map: function (value) { return rounded(value); } },
    { old: "journalDatetime", neu: "journalDatetime", reason: "", map: timestampString },
    { old: "slotDatetime", neu: "slotDatetime", reason: "", map: timestampString },
    { old: "patientNo", neu: "patientKey", fromPatient: true, reason: "patientNo is taken from patient.patientKey." },
    { old: "hkid", neu: "hkid", fromPatient: true, reason: "hkid is taken from the patient object when the appointment has none." }
  ];
  if (/findSpecialty|doCallSpec/i.test(kind)) {
    rules.push({ old: "eisSpecialty", neu: "imisSpecialty", reason: "eisSpecialty is read from imisSpecialty." });
  }
  if (/doCallEis|findOpasUnit|doCallSubSpec/i.test(kind)) {
    rules.push({ old: "opasPayFlag", neu: "drugCharge", reason: "opasPayFlag is read from drugCharge." });
  }
  for (var n = 1; n <= 6; n++) rules.push({ old: "CCCode" + n, neu: "unicodeInt" + n, unicode: true, n: n });
  return rules;
}

function jsonCopied(kind, name) {
  if (name === "payCode" || name === "payFlag" || name === "subSpecialty") return false;
  return codeReads(kind, name);
}

function codeReads(kind, name) {
  var common = {
    apptSeq: 1, caseNo: 1, chargeAmount: 1, chargeCode: 1, eisServiceType: 1, eisSpecialty: 1, eisSubSpecialty: 1,
    journalAmount: 1, journalDatetime: 1, patientNo: 1, payCode: 1, payFlag: 1, paymentMeans: 1, shroffGroup: 1,
    slotDatetime: 1, specialty: 1, subSpecialty: 1, waiverEffDate: 1, waiverExpDate: 1, waiverPercentage: 1,
    waiverRefNo: 1, additionNepKey1: 1, additionNepKey2: 1, nepSearchKey: 1, hkid: 1, dob: 1, exactdobFlag: 1,
    receiptNo: 1, newWaiverType: 1, updSys: 1, chargeGroup: 1, opasUnit: 1, opasUnitDescription: 1,
    specialtyDescription: 1, opasPayCode: 1, opasPayFlag: 1, patientKey: 1, patientName: 1, chineseName: 1,
    HKID: 1, DOB: 1, sex: 1, exactDOBFlag: 1, CCCode1: 1, CCCode2: 1, CCCode3: 1, CCCode4: 1, CCCode5: 1, CCCode6: 1
  };
  if (/doCallSubSpec/i.test(kind)) {
    return { opasUnit: 1, opasUnitDescription: 1, specialty: 1, chargeGroup: 1 }[name] === 1;
  }
  if (/doCallSpec|findSpecialty/i.test(kind) && !/findOpasUnit|doCallSubSpec|doCallEis/i.test(kind)) {
    return { specialty: 1, specialtyDescription: 1, eisSpecialty: 1, description: 1, imisSpecialty: 1 }[name] === 1;
  }
  if (/doCallEis/i.test(kind)) {
    return { eisServiceType: 1, eisSpecialty: 1, eisSubSpecialty: 1, opasPayFlag: 1, drugCharge: 1 }[name] === 1;
  }
  return common[name] === 1;
}

function requestFacts(head) {
  var json = parseJson(head) || {};
  return {
    source: textOf(json._logSource),
    hospital: textOf(json.hospitalCode),
    apptSeq: textOf(json.apptSeq),
    caseNo: textOf(json.caseNo),
    patientKey: textOf(json.patientKey),
    specialty: textOf(json.specialty || (json.specialtyList && json.specialtyList[0]))
  };
}

module.exports = {
  compare: compare,
  compareFull: compareFull,
  parseJson: parseJson,
  requestFacts: requestFacts,
  undoCp850: undoCp850
};
