(function () {
  var root = document.getElementById("view-station");
  if (!root) return;

  root.innerHTML =
    '<div class="charge-read">' +
    "<h2>Frontend login</h2>" +
    "<p>Each environment opens <span class=\"mono\">opas_login.jsp</span>. The query string is a sample login.</p>" +
    '<table class="means-map" id="station-env-table"><thead><tr><th>Environment</th><th>URL</th></tr></thead><tbody>' +
    envRow("SIT", "https://fcs-corp-sit.server.ha.org.hk:16495/fcsys/login/opas_login.jsp?hospital_cde=VH&user_id=FCSUAT1&workstation_id=PBRCLYTEMP&location_id=VH1234") +
    envRow("UAT", "https://fcs-corp-uat.server.ha.org.hk:28495/fcsys/login/opas_login.jsp?hospital_cde=VH&user_id=FCSUAT1&workstation_id=FCSODC&location_id=VH1234") +
    envRow("Production", "https://fcs-corp-prd.server.ha.org.hk:34495/fcsys/login/opas_login.jsp?hospital_cde=QEH&user_id=cck585&workstation_id=PBRCGARY&location_id=VH1234") +
    "</tbody></table>" +

    "<h2>URL parameters</h2>" +
    '<table class="means-map" id="station-url-table"><thead><tr><th>URL parameter</th><th>Column</th><th>Needed</th><th>If left out</th></tr></thead><tbody>' +
    urlRow("hospital_cde", "HOSPITAL_CDE", "Yes", "The lookup compares a blank hospital. The row does not match, and login says the PC is not registered.") +
    urlRow("user_id", "", "Yes", "The login form says You must enter the User ID.") +
    urlRow("workstation_id", "HOST_NAME", "Yes", "Login substitutes the caller PC name and looks that name up. No approved row says the PC is not registered.") +
    urlRow("location_id", "", "For Octopus", "The login shows [INFORMATION] Octopus Payment is NOT available. [Octopus ID:] and drug payment hides OC. A value shows Octopus Payment is available, keeps OC, and is sent with the Octopus location log.") +
    "</tbody></table>" +

    "<h2>Station row</h2>" +
    "<p>Green boxes are the values usually changed for a new workstation. Each dropdown starts on the most common production value. <span class=\"mono\">LAST_UPD_DTM</span> is <span class=\"mono\">SYSTIMESTAMP</span>, and <span class=\"mono\">ID</span> is left out.</p>" +
    '<form class="station-form" id="station-form" autocomplete="off">' +
    select("usual", "HOSPITAL_CDE", "hospital", hospOptions(), "PYN") +
    field("usual", "HOST_NAME", "workstation", "text", "", "New workstation") +
    field("usual", "STATION_ID", "station", "text", "", "Blank copies HOST_NAME") +
    select("usual", "SYSTEM", "system", [["PBRC", "PBRC (2796)"], ["MAM", "MAM (419)"]], "PBRC") +
    select("unused", "LAST_UPD_BY", "updBy", [["pbrcitd", "pbrcitd (1177)"], ["fcsapi", "fcsapi (1118)"], ["pbrcoper", "pbrcoper (488)"], ["sa", "sa (420)"], ["pbrcsupport", "pbrcsupport (9)"], ["pbrcsuppoer", "pbrcsuppoer (3)"]], "pbrcitd") +
    select("", "APPROVAL", "approval", [["Y", "Y (3157)"], ["N", "N (58)"]], "Y") +
    select("usual", "THERMAL_PORT", "thermalPort", [["lpt1", "lpt1 (1367)"], ["LPT1", "LPT1 (1128)"], ["", "null (455)"], ["lpt2", "lpt2 (229)"], ["lpt3", "lpt3 (34)"], ["LPT3", "LPT3 (1)"], ["1", "1 (1)"]], "lpt1") +
    select("usual", "OCTOPUS_PORT", "octopus", [["1", "1 (2307)"], ["", "null (885)"], ["2", "2 (23)"]], "1") +
    select("usual", "REMARKS", "remarks", remarkOptions(), "EPSON TM-T88IV Receipt") +
    field("", "REMARKS other", "remarksOther", "text", "") +
    select("", "PAYMENT_MODULE", "payment", [["", "null (3177)"], ["1", "1 (38)"]], "") +
    select("", "SHROFF_GRP", "shroff", [["", "null (3146)"], ["fcs", "fcs (69)"]], "") +
    select("unused", "USER_NAME", "userName", [["fcs", "fcs (2619)"], ["MAM", "MAM (419)"], ["pbrcsupport", "pbrcsupport (87)"], ["", "null (62)"], ["pbrcsysmon", "pbrcsysmon (25)"], ["pbrcitd", "pbrcitd (1)"], ["FCS", "FCS (1)"]], "fcs") +
    select("unused", "CONTACT_INFO", "contact", [["", "null (3211)"]], "") +
    select("unused", "IS_LOGIN_SAM", "sam", [["Y", "Y (3211)"], ["", "null (4)"]], "Y") +
    select("unused", "IS_LOGIN_OPAS", "opas", [["N", "N (3211)"], ["", "null (4)"]], "N") +
    select("unused", "IS_OPAS_INTEGRATED", "integrated", [["N", "N (1828)"], ["Y", "Y (1384)"], ["", "null (3)"]], "N") +
    select("", "IS_LDAP_LOGIN", "ldap", [["Y", "Y (2945)"], ["", "null (270)"]], "Y") +
    select("usual", "IS_PRINT_AGENT", "print", [["", "null (1206)"], ["4", "4 (1105)"], ["Y", "Y (418)"], ["1", "1 (367)"], ["3", "3 (97)"], ["2", "2 (14)"], ["0", "0 (8)"]], "") +
    select("", "EPAY_VENDOR_NAME", "vendor", [["QFPAY", "QFPAY (3215)"]], "QFPAY") +
    select("", "PHCC_EFF_DTE", "phcc", [["2099-01-01", "2099-01-01 (2551)"], ["2025-10-11", "2025-10-11 (640)"], ["2026-01-01", "2026-01-01 (22)"], ["2025-10-10", "2025-10-10 (1)"], ["", "null (1)"]], "2099-01-01") +
    "</form>" +
    '<div class="station-actions">' +
    '<button type="button" id="station-copy-sql" class="primary">Copy INSERT</button>' +
    "</div>" +
    '<pre class="sql" id="station-sql"></pre>' +
    '<p class="src" id="station-copy-msg" role="status"></p>' +

    "<h2>HOSP_STATION_MAPPING</h2>" +
    "<p>Login reads one approved row by <span class=\"mono\">HOST_NAME</span> and <span class=\"mono\">HOSPITAL_CDE</span>. <span class=\"mono\">EPAY_VENDOR_NAME</span> must exist on <span class=\"mono\">fc_epayment_info</span>. A dim row is still written by the INSERT. The frontend does not read it.</p>" +
    '<table class="means-map" id="station-db-table"><thead><tr><th>Column</th><th>Needed</th><th>If empty</th><th>Production 20261126, 3215 rows</th></tr></thead><tbody>' +
    dbRow("HOSPITAL_CDE", "Yes", "The lookup compares a blank hospital. The row does not match, and login says the PC is not registered.", "53 hospital codes. Largest counts are PYN 328, TMH 254, QMH 239, PWH 235, QEH 226, UCH 218.") +
    dbRow("HOST_NAME", "Yes", "Login uses the caller PC name. No approved row for that name says the PC is not registered.", "3,082 names. Type the new workstation. The list is not a dropdown.") +
    dbRow("STATION_ID", "Yes", "The session workstation is empty, so later payment and receipt calls have no workstation. A blank box on this page copies HOST_NAME.", "3,088 ids, usually the same as the host name. Type it, or leave the box blank to copy HOST_NAME.") +
    dbRow("SYSTEM", "For the menu", "Empty opens the FCS menu. MAM opens the amend-charge menu.", "PBRC 2796, MAM 419.") +
    dbRow("LAST_UPD_BY", "No", "No screen reads it.", "pbrcitd 1177, fcsapi 1118, pbrcoper 488, sa 420, pbrcsupport 9, pbrcsuppoer 3.", true) +
    dbRow("LAST_UPD_DTM", "No", "No screen reads it.", "1,713 timestamps. The INSERT uses SYSTIMESTAMP.", true) +
    dbRow("APPROVAL", "Yes", "Anything other than Y says the PC is not registered.", "Y 3157, N 58.") +
    dbRow("THERMAL_PORT", "For receipt print", "The receipt is sent with an empty port.", "lpt1 1367, LPT1 1128, empty 455, lpt2 229, lpt3 34, LPT3 1, 1 once.") +
    dbRow("OCTOPUS_PORT", "For Octopus", "Null drops OC from the payment list. A value is the COM port passed to octopusInitcomm.", "1 is 2307, empty 885, 2 is 23.") +
    dbRow("REMARKS", "For the printer name", "Receipt print is sent with an empty printer name.", "105 distinct. Common names: EPSON TM-T88IV Receipt 1105, OPAS 798, empty 541, Thermal GX420t 160, BIXOLON Receipt 89. Other rows are old switch notes.") +
    dbRow("PAYMENT_MODULE", "For EC", "Null drops EC. A value keeps the Move5000 payment means.", "empty 3177, 1 is 38.") +
    dbRow("SHROFF_GRP", "For PFMS", "Itemized charge gets no shroff group from this row.", "empty 3146, fcs 69.") +
    dbRow("USER_NAME", "No", "No screen reads it.", "fcs 2619, MAM 419, pbrcsupport 87, empty 62, pbrcsysmon 25, pbrcitd 1, FCS 1.", true) +
    dbRow("CONTACT_INFO", "No", "No screen reads it.", "Empty on 3211 rows.", true) +
    dbRow("IS_LOGIN_SAM", "No", "The login procedure does not select it.", "Y 3211, empty 4.", true) +
    dbRow("IS_LOGIN_OPAS", "No", "The login procedure does not select it.", "N 3211, empty 4.", true) +
    dbRow("IS_OPAS_INTEGRATED", "No", "Login, payment, and print do not read it. Y, N, and empty behave the same. Registration inserts N. fcs_p_u_upsert_hosp_station writes Y and does not look at the old value.", "N 1828, Y 1384, empty 3.", true) +
    dbRow("IS_LDAP_LOGIN", "Yes", "A value other than Y opens the SAM login page. Y checks the password with LDAP.", "Y 2945, empty 270.") +
    dbRow("IS_PRINT_AGENT", "For the print path", "A blank flag is treated as 4 when a receipt file already exists. 1 is the payment agent, 2 is CCP, 3 hides the pharm ticket, 4 shows it.", "empty 1206, 4 is 1105, Y 418, 1 is 367, 3 is 97, 2 is 14, 0 is 8. The print script compares 1, 2, 3, and 4.") +
    dbRow("EPAY_VENDOR_NAME", "Yes", "The join to fc_epayment_info fails, and login says the PC is not registered.", "QFPAY on all 3215 rows.") +
    dbRow("ID", "No", "The database assigns it. The INSERT leaves it out.", "Identity. 3,170 distinct values.", true) +
    dbRow("PHCC_EFF_DTE", "For PHCC", "Null keeps the old hospital name. Drug payment uses the PHCC name once today is on or after this timestamp.", "2099-01-01 is 2551, 2025-10-11 is 640, 2026-01-01 is 22, 2025-10-10 is 1, empty 1.") +
    "</tbody></table>" +
    "</div>";

  var form = document.getElementById("station-form");
  form.addEventListener("input", render);
  form.addEventListener("change", render);
  document.getElementById("station-copy-sql").addEventListener("click", function () {
    copy(document.getElementById("station-sql").textContent, "INSERT copied.");
  });
  render();

  function render() {
    document.getElementById("station-sql").textContent = insertSql(values());
  }

  function values() {
    var remarks = val("remarks");
    if (remarks === "other") remarks = val("remarksOther").trim();
    var workstation = val("workstation").trim();
    var station = val("station").trim() || workstation;
    return {
      hospital: val("hospital").trim(),
      workstation: workstation,
      station: station,
      system: val("system").trim(),
      approval: val("approval"),
      thermalPort: val("thermalPort").trim(),
      octopusPort: val("octopus"),
      remarks: remarks.trim(),
      payment: val("payment").trim(),
      shroff: val("shroff").trim(),
      userName: val("userName").trim(),
      contact: val("contact").trim(),
      sam: val("sam"),
      opas: val("opas"),
      integrated: val("integrated"),
      ldap: val("ldap"),
      print: val("print"),
      vendor: val("vendor").trim(),
      phcc: val("phcc").trim(),
      updBy: val("updBy").trim()
    };
  }

  function insertSql(v) {
    return "-- Copy and run yourself. This page does not execute it.\n" +
      "-- ID is identity and is omitted.\n" +
      "-- EPAY_VENDOR_NAME must already exist on fc_epayment_info, and APPROVAL must be Y, or login says the PC is not registered.\n" +
      "INSERT INTO hosp_station_mapping (\n" +
      "  hospital_cde, host_name, station_id, system,\n" +
      "  last_upd_by, last_upd_dtm, approval,\n" +
      "  thermal_port, octopus_port, remarks,\n" +
      "  payment_module, shroff_grp, user_name, contact_info,\n" +
      "  is_login_sam, is_login_opas, is_opas_integrated,\n" +
      "  is_ldap_login, is_print_agent, epay_vendor_name, phcc_eff_dte\n" +
      ") VALUES (\n" +
      "  " + q(v.hospital) + ", " + q(v.workstation) + ", " + q(v.station) + ", " + q(v.system) + ",\n" +
      "  " + q(v.updBy) + ", SYSTIMESTAMP, " + q(v.approval) + ",\n" +
      "  " + q(v.thermalPort) + ", " + q(v.octopusPort) + ", " + q(v.remarks) + ",\n" +
      "  " + q(v.payment) + ", " + q(v.shroff) + ", " + q(v.userName) + ", " + q(v.contact) + ",\n" +
      "  " + q(v.sam) + ", " + q(v.opas) + ", " + q(v.integrated) + ",\n" +
      "  " + q(v.ldap) + ", " + q(v.print) + ", " + q(v.vendor) + ", " + timestamp(v.phcc) + "\n" +
      ");";
  }

  function timestamp(s) {
    if (!s) return "NULL";
    var day = s.length === 10 ? s + " 00:00:00" : s;
    return "TIMESTAMP " + q(day);
  }

  function q(s) {
    if (s == null || String(s) === "") return "NULL";
    return "'" + String(s).replace(/'/g, "''") + "'";
  }

  function val(id) {
    return document.getElementById("st-" + id).value;
  }

  function field(extra, label, id, type, value, placeholder) {
    return '<label class="' + extra + '">' + esc(label) +
      '<input id="st-' + id + '" type="' + type + '" value="' + esc(value) + '" placeholder="' + esc(placeholder || "") + '" spellcheck="false">' +
      "</label>";
  }

  function hospOptions() {
    var counts = {
      AHN: 68, AJC: 2, BBH: 6, BH: 24, CHC: 5, CKC: 2, CMC: 174, CPH: 17, DKC: 9, DKH: 7,
      EKS: 2, FYK: 6, GH: 24, HAO: 7, HCH: 21, HHH: 35, HKE: 25, HO: 1, KCH: 75, KH: 39,
      KTH: 74, KWH: 117, ML: 6, NDH: 121, NLT: 56, OLM: 96, PMH: 167, POH: 32, PWH: 235,
      PYN: 328, QEH: 226, QES: 1, QMH: 239, RH: 66, RH0: 1, RHO: 1, SH: 11, SJH: 37, SYG: 1,
      TKO: 143, TMH: 254, TPH: 9, TSH: 35, TWE: 30, TWH: 24, TYH: 4, UCH: 218, VPG: 3,
      WCH: 4, WPC: 3, WTS: 15, YCH: 106, YFS: 3
    };
    return Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b);
    }).map(function (code) {
      return [code, code + " (" + counts[code] + ")"];
    });
  }

  function remarkOptions() {
    var names = [
      ["EPSON TM-T88IV Receipt", 1105],
      ["OPAS", 798],
      ["", 541],
      ["Thermal GX420t", 160],
      ["BIXOLON Receipt", 89],
      ["Thermal Printer (OP)", 54],
      ["PBRC", 27],
      ["Thermal PC42E-T", 20],
      ["Thermal TLP 2844-Z", 17],
      ["Microsoft Print to PDF", 13],
      ["Thermal PC42t", 12],
      ["Thermal PC42t plus", 11],
      ["Thermal GX420t (IP)", 6],
      ["Thermal Printer (IP)", 6],
      ["Thermal XD3-40t", 5]
    ];
    var options = names.map(function (pair) {
      return [pair[0], (pair[0] || "null") + " (" + pair[1] + ")"];
    });
    options.push(["other", "other"]);
    return options;
  }

  function select(extra, label, id, options, selected) {
    var html = '<label class="' + extra + '">' + esc(label) + '<select id="st-' + id + '">';
    options.forEach(function (pair) {
      var mark = pair[0] === selected ? " selected" : "";
      html += '<option value="' + esc(pair[0]) + '"' + mark + ">" + esc(pair[1]) + "</option>";
    });
    return html + "</select></label>";
  }

  function dbRow(col, needed, ifEmpty, seen, unused) {
    return "<tr" + (unused ? ' class="unused"' : "") + "><td>" + esc(col) + "</td><td>" + esc(needed) + "</td><td>" + esc(ifEmpty) + "</td><td>" + esc(seen) + "</td></tr>";
  }

  function envRow(env, url) {
    return "<tr><td>" + esc(env) + "</td><td><a href=\"" + esc(url) + "\">" + esc(url) + "</a></td></tr>";
  }

  function urlRow(param, col, needed, ifEmpty) {
    return "<tr><td>" + esc(param) + "</td><td>" + esc(col) + "</td><td>" + esc(needed) + "</td><td>" + esc(ifEmpty) + "</td></tr>";
  }

  function copy(text, msg) {
    var note = document.getElementById("station-copy-msg");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        note.textContent = msg;
      }, function () {
        note.textContent = "Copy failed. Select the text and copy it.";
      });
    } else {
      note.textContent = "Copy failed. Select the text and copy it.";
    }
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
