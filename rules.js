(function () {
  var TITLES = {
    sdc: "SDC data flow",
    "receipt-moe": "Receipt type — MOE",
    "receipt-sfi": "Receipt type — SFI",
    charge: "OPAS pay flag",
    "reg-generic": "FCS Generic",
    "reg-payha": "PayHA",
    "reg-kiosk": "Kiosk",
    "reg-frontend": "Frontend",
    log: "Request log",
    health: "Production health",
    path: "CMS path",
    day: "Day counts",
    dhp: "DHP canary",
    "dhp-flow": "DHP flows",
    mam: "MAM login",
    station: "Station row",
    dayend: "Day-end non production",
    scripts: "Self script",
    other: "Other system"
  };

  document.body.classList.add("mod-sdc");
  document.querySelector(".side").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-module]");
    if (!btn) return;
    show(btn.getAttribute("data-module"));
  });

  var RATE_SQL =
    "SELECT pay_cde, pay_flag, charge_rate, effective_dte, expiry_dte\n" +
    "FROM (\n" +
    "  SELECT pay_cde, pay_flag, charge_rate, effective_dte, expiry_dte,\n" +
    "         ROW_NUMBER() OVER (\n" +
    "           PARTITION BY pay_cde, pay_flag\n" +
    "           ORDER BY effective_dte DESC\n" +
    "         ) rn\n" +
    "  FROM fc_charge_rates\n" +
    "  WHERE hospital_cde = 'QEH'\n" +
    "    AND service_cde = 'SDC'\n" +
    "    AND TRUNC(effective_dte) <= TRUNC(SYSDATE)\n" +
    "    AND (expiry_dte IS NULL OR TRUNC(expiry_dte) >= TRUNC(SYSDATE))\n" +
    ")\n" +
    "WHERE rn = 1\n" +
    "ORDER BY pay_cde, pay_flag;";

  renderReceiptMoe();
  renderReceiptSfi();
  renderCharge();

  function show(id) {
    var reg = id.indexOf("reg-") === 0;
    var log = id === "log";
    document.body.className = "mod-" + id;
    document.querySelectorAll("[data-module]").forEach(function (btn) {
      btn.classList.toggle("on", btn.getAttribute("data-module") === id);
    });
    document.getElementById("view-sdc").classList.toggle("hidden", id !== "sdc");
    document.getElementById("view-health").classList.toggle("hidden", id !== "health");
    document.getElementById("view-path").classList.toggle("hidden", id !== "path");
    document.getElementById("view-day").classList.toggle("hidden", id !== "day");
    document.getElementById("view-dhp").classList.toggle("hidden", id !== "dhp");
    document.getElementById("view-dhp-flow").classList.toggle("hidden", id !== "dhp-flow");
    document.getElementById("view-mam").classList.toggle("hidden", id !== "mam");
    document.getElementById("view-station").classList.toggle("hidden", id !== "station");
    document.getElementById("view-receipt-moe").classList.toggle("hidden", id !== "receipt-moe");
    document.getElementById("view-receipt-sfi").classList.toggle("hidden", id !== "receipt-sfi");
    document.getElementById("view-charge").classList.toggle("hidden", id !== "charge");
    document.getElementById("view-regression").classList.toggle("hidden", !reg);
    document.getElementById("view-log").classList.toggle("hidden", !log);
    document.getElementById("view-dayend").classList.toggle("hidden", id !== "dayend");
    document.getElementById("view-scripts").classList.toggle("hidden", id !== "scripts");
    document.getElementById("view-other").classList.toggle("hidden", id !== "other");
    document.getElementById("page-title").textContent = TITLES[id] || id;
    document.title = "FCS system — " + (TITLES[id] || id);
    if (reg && window.fcsRegression) window.fcsRegression.show(id.slice(4));
    if (log && window.fcsRegression) window.fcsRegression.showLog();
  }

  function observedMeansTable(which) {
    var names = {
      CQ: "CHEQUE", CA: "CASH", EP: "EPS", DP: "PNEUMOCONIOSIS COMPENSATION FUND BOARD",
      DM: "SERVICOS DE SAUDE - MACAU", DO: "DEFERRED PAYMENT - OTHERS", FC: "FOREIGN CURRENCY",
      CR: "CREDIT CARD", DS: "DEFERRED PAYMENT", HA: "HA STAFF BENEFIT - NO CHARGE", OC: "OCTOPUS",
      DG: "PAYMENT BY DEPT OF HEALTH", DA: "PAYMENT BY CCF", DB: "PAYMENT BY CCF Phase 2",
      DX: "PAYMENT BY SF/CCF", MC: "Credit Card", MO: "Octopus", MA: "AlipayHK", MW: "WeChat Pay",
      AP: "Apple Pay", MG: "Google Pay", MJ: "JETCO Pay", MP: "PayMe", QA: "AlipayHK", QW: "WeChat Pay",
      DW: "DEFER PAYMENT FOR WAIVER", MF: "FPS", MT: "HA Go - Tap & Go", MB: "HA Go - BoC Pay",
      QP: "PayMe", QB: "BoC Pay", QT: "Tap & Go", DU: "Payment by TWGHs - for standard drug"
    };
    var moe = [
      ["DD", "DO", 113, 59, 285, ""],
      ["DD", "DP", 3, 17, 7, ""],
      ["DD", "DW", 1018, 3516, 2649, ""],
      ["DF", "", 150077, 220233, 175535, "The receipt stores no payment means."],
      ["DR", "A1", 1, 1, 2, ""],
      ["DR", "AP", 11232, 8746, 7246, ""],
      ["DR", "CA", 26639, 35027, 29130, ""],
      ["DR", "CQ", 1, null, 1, ""],
      ["DR", "CR", 32804, 23575, 28214, ""],
      ["DR", "EC", 4, 17, 8, ""],
      ["DR", "EO", 39, 54, 25, ""],
      ["DR", "EP", 691, 156, 952, ""],
      ["DR", "EW", 1, 5, null, ""],
      ["DR", "FP", 113, 98, 45, ""],
      ["DR", "HO", 5, null, 2, ""],
      ["DR", "MA", 13254, 24626, 12344, ""],
      ["DR", "MB", 450, 587, 388, ""],
      ["DR", "MC", 3328, 1814, 2165, ""],
      ["DR", "MF", 1093, 1346, 1000, ""],
      ["DR", "MG", 1215, 1062, 696, ""],
      ["DR", "MO", 3796, 7243, 3314, ""],
      ["DR", "MP", 6900, 6926, 4895, ""],
      ["DR", "MT", 14, 24, 13, ""],
      ["DR", "MW", 1564, 2545, 1516, ""],
      ["DR", "OC", 192057, 366513, 208565, ""],
      ["DR", "PC", 6, 14, 6, ""],
      ["DR", "PS", 19, 14, 10, ""],
      ["DR", "QA", 13206, 29369, 19515, ""],
      ["DR", "QB", 365, 419, 425, ""],
      ["DR", "QP", 771, 843, 839, ""],
      ["DR", "QR", 1, null, 1, ""],
      ["DR", "QW", 1925, 3854, 2832, ""],
      ["DR", "S1", 153, 200, 119, ""],
      ["DV", "", 149802, 387137, 181488, "The receipt stores no payment means."],
      ["DV", "CA", 213, 203, 785, ""],
      ["TM", "CA", 92, 101, 74, ""],
      ["TU", "CA", 1, 196, 270, ""]
    ];
    var sfi = [
      ["DD", "DA", 1480, 1877, 2032, ""],
      ["DD", "DG", 14345, 4592, 9152, ""],
      ["DD", "DM", 296, 5, null, ""],
      ["DD", "DO", 1351, 164, 120, ""],
      ["DD", "DS", 8721, 10313, 8071, "The code table says deferred payment. The SFI screen uses DS for Samaritan Fund discount items."],
      ["DF", "", 19, null, 61, ""],
      ["DH", "HA", 8004, 1811, 3631, ""],
      ["DR", "AP", 1039, 168, 586, ""],
      ["DR", "BI", 1591, null, null, ""],
      ["DR", "CA", 2231, 2428, 1644, ""],
      ["DR", "CQ", 249, 16, 16, ""],
      ["DR", "CR", 25381, 6522, 7554, ""],
      ["DR", "EC", 4, 9, 103, ""],
      ["DR", "EO", null, 19, null, ""],
      ["DR", "EP", 911, 725, 738, ""],
      ["DR", "EW", null, 2, null, ""],
      ["DR", "FP", 36, 11, 1, ""],
      ["DR", "MA", 313, 122, 400, ""],
      ["DR", "MB", 31, 6, 17, ""],
      ["DR", "MC", 559, 114, 564, ""],
      ["DR", "MF", 117, 56, 127, ""],
      ["DR", "MG", 101, 14, 48, ""],
      ["DR", "MO", 16, 20, 31, ""],
      ["DR", "MP", 195, 75, 115, ""],
      ["DR", "MT", null, null, 1, ""],
      ["DR", "MW", 28, 24, 29, ""],
      ["DR", "OC", 687, 433, 723, ""],
      ["DR", "PC", 123, null, null, ""],
      ["DR", "PS", 22, 2, null, ""],
      ["DR", "QA", 678, 521, 492, ""],
      ["DR", "QB", 12, null, 1, ""],
      ["DR", "QP", 9, 2, 5, ""],
      ["DR", "QR", 49, null, null, ""],
      ["DR", "QS", 9, null, null, ""],
      ["DR", "QW", 118, 104, 49, ""],
      ["DR", "S1", 3, 13, null, ""],
      ["TM", "CA", 1, null, null, ""],
      ["TU", "CA", 102, 96, 35, ""]
    ];
    var dayend = {
      "SDC|DD|DO": [27, 37, 165],
      "SDC|DD|DP": [3, 14, 6],
      "SDC|DD|DW": [554, 1900, 1747],
      "SDC|DF|": [147978, 218175, 172738],
      "SDC|DV|": [144140, 376575, 162560],
      "SFI|DH|HA": [7921, 1347, 3573]
    };
    function total(row) { return (row[2] || 0) + (row[3] || 0) + (row[4] || 0); }
    function dayShare(path, row) {
      var found = dayend[path + "|" + row[0] + "|" + row[1]];
      return found || [0, 0, 0];
    }
    function madeBy(totals, days) {
      var hosp = ["QMH", "TMH", "QEH"];
      var heavy = [];
      var other = [];
      var anyDay = false;
      for (var i = 0; i < 3; i++) {
        if (totals[i] == null) continue;
        if (days[i] > 0) anyDay = true;
        if (totals[i] > 0 && days[i] / totals[i] >= 0.9) heavy.push(hosp[i]);
        else if (days[i] > 0) other.push(hosp[i]);
      }
      if (!anyDay) return "Counter";
      if (!other.length) return "Dayend";
      if (!heavy.length) return "Split";
      return "Dayend except " + other.join(", ");
    }
    function hospitalCell(totalCount, dayCount) {
      if (totalCount == null) return cell("—", "num");
      if (!dayCount) return cell(count(totalCount), "num");
      var counter = totalCount - dayCount;
      var heavy = totalCount > 0 && dayCount / totalCount >= 0.9;
      var detail = counter === 0
        ? '<span class="share heavy">All dayend</span>'
        : '<span class="share' + (heavy ? " heavy" : "") + '">dayend ' + count(dayCount) + '</span><span class="share">counter ' + count(counter) + "</span>";
      return cell(count(totalCount) + detail, "num");
    }
    function cell(text, cls) {
      return "<td" + (cls ? ' class="' + cls + '"' : "") + ">" + text + "</td>";
    }
    function count(n) {
      if (n == null) return "—";
      return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    var typeMeaning = {
      DR: "Charged receipt. The patient pays.",
      DD: "Deferred payment receipt.",
      DF: "No-charge receipt. The charge is 0, or a no-charge code is set.",
      DV: "Waiver receipt.",
      DH: "HA staff benefit receipt.",
      TM: "PBRC refund.",
      TU: "PBRC refund."
    };
    function oneTable(title, path, rows) {
      var peak = {};
      rows.forEach(function (row) {
        var n = total(row);
        if (peak[row[0]] == null || n > peak[row[0]]) peak[row[0]] = n;
      });
      rows.sort(function (a, b) {
        if (a[0] !== b[0]) return peak[b[0]] - peak[a[0]];
        var diff = total(b) - total(a);
        if (diff) return diff;
        return String(a[1]).localeCompare(String(b[1]));
      });
      var seen = {};
      var body = rows.map(function (row) {
        var code = row[1];
        var remark = row[5];
        var days = dayShare(path, row);
        var typeLabel = seen[row[0]] ? "" : row[0];
        var meaning = seen[row[0]] ? "" : (typeMeaning[row[0]] || "");
        seen[row[0]] = true;
        if (code && !names[code]) remark = remark ? remark + " Not in the pasted fc_payment_means list." : "Not in the pasted fc_payment_means list.";
        return "<tr>" +
          cell(typeLabel) +
          cell(meaning) +
          cell(code || "None") +
          cell(code ? (names[code] || "") : "") +
          cell(madeBy([row[2], row[3], row[4]], days)) +
          hospitalCell(row[2], days[0]) +
          hospitalCell(row[3], days[1]) +
          hospitalCell(row[4], days[2]) +
          cell(remark) +
          "</tr>";
      }).join("");
      return "<h2>" + title + "</h2>" +
        '<table class="means-map"><thead><tr><th>Receipt type</th><th>Meaning</th><th>Payment means</th><th>Description</th><th>Made by</th><th>QMH</th><th>TMH</th><th>QEH</th><th>Remarks</th></tr></thead><tbody>' +
        body + "</tbody></table>";
    }
    if (which === "SFI") return oneTable("SFI, service SFI", "SFI", sfi);
    return oneTable("MOE, service SDC", "SDC", moe);
  }

  function meansRead(which) {
    var path = which === "SFI"
      ? "These rows are service SFI."
      : "These rows are service SDC, the MOE drug service.";
    return '<div class="charge-read">' +
      "<h2>Payment means to receipt type</h2>" +
      "<p>QMH, TMH, and QEH, 1 Jan 2026 to 1 Nov 2026. The path is <span class=\"mono\">fc_case_services.service_cde</span> on the same hospital, case, and service time. " + path + " The receipt type meaning comes from the payment code. The payment-means description comes from <span class=\"mono\">fc_payment_means</span>. Dayend is <span class=\"mono\">fc_user</span> <span class=\"mono\">SYSFCS</span>. A hospital cell shows the dayend and counter counts when both exist. The dayend line is marked when that hospital's dayend count is at least 90% of the pair, so a few counter receipts stay visible. Made by is Dayend only when every hospital with rows is at that level. A dash means that hospital had no such pair.</p>" +
      observedMeansTable(which) +
      "</div>";
  }

  function renderReceiptMoe() {
    var root = document.getElementById("view-receipt-moe");
    root.innerHTML =
      picks(["DF", "DF"], ["DD", "DD"], ["DR", "DR"], ["DV", "DV"]) +
      meansRead("SDC") +
      '<p class="src">Counts are status IS and debit. Blank means are shown as None. TM and TU are the PBRC refund types. Charged DR receipts are counter only. The batch creates DF, DV, and DD for DM, DP, DO, DW, and DU, and it skips a normal patient-pay case.</p>' +
      '<div class="stories">' +
      chapter("MOE drug payment", [
        scene("DR", [
          ["OPAS", "S"],
          ["charge", "80"],
          ["mean", "CA"],
          ["amount", "80"],
          ["that's why", "DR"]
        ]),
        scene("DD", [
          ["OPAS", "S"],
          ["charge", "80"],
          ["mean", "DM, DO, DP, or DW"],
          ["amount", "0"],
          ["that's why", "DD"]
        ]),
        scene("DD", [
          ["OPAS", "P"],
          ["mean", "DT becomes DU"],
          ["charge", "80"],
          ["amount", "80"],
          ["that's why", "DD"]
        ]),
        scene("DF", [
          ["OPAS", "S"],
          ["charge", "80"],
          ["no-charge code", "set"],
          ["amount", "0"],
          ["that's why", "DF"]
        ]),
        scene("DF", [
          ["charge", "0"],
          ["that's why", "DF"]
        ]),
        scene("DF", [
          ["OPAS", "N"],
          ["no-charge table", "matches"],
          ["amount", "0"],
          ["that's why", "DF"]
        ]),
        scene("DF", [
          ["payment", "not saved"],
          ["chargeable", "above 0"],
          ["charge", "0"],
          ["existing DF", "none"],
          ["that's why", "DF"]
        ]),
        scene("DV", [
          ["OPAS", "S"],
          ["charge", "80"],
          ["pay code", "PA or TPA"],
          ["amount", "0"],
          ["waiver", "80"],
          ["issued by", "PA"],
          ["that's why", "DV"]
        ]),
        scene("DV DR", [
          ["OPAS", "S"],
          ["charge", "80"],
          ["waiver", "on"],
          ["pay code", "not PA or TPA"],
          ["waiver amount", "40"],
          ["amount", "40"],
          ["issued by", "MSW"],
          ["that's why", "DV + DR"]
        ]),
        scene("stop", [
          ["charge", "80"],
          ["mean", "DS"],
          ["waiver", "off"],
          ["amount", "0"],
          ["that's why", "no receipt"]
        ])
      ]) +
      "</div>" +
      '<p class="src">80 and 40 are sample amounts. A full waive is DV only. A partial waive is DV and DR. MOE: <span class="mono">fcs_p_u_drug_payment_payha</span>. <a href="https://app.notion.com/p/3ad318e47d5080c198d2ec8b0120dd8e">Receipt note</a></p>';
    bindPicks(root);
  }

  function renderReceiptSfi() {
    var root = document.getElementById("view-receipt-sfi");
    root.innerHTML =
      picks(["DR", "DR"], ["DH", "DH"], ["DD", "DD"], ["DF", "DF"]) +
      meansRead("SFI") +
      '<p class="src">Counts are status IS and debit. Blank means are shown as None. TM and TU are the PBRC refund types. DH is the HA staff benefit receipt. The SFI DD rows in this range are counter.</p>' +
      '<div class="stories">' +
      chapter("SFI payment", [
        scene("DR", [
          ["charge", "80"],
          ["mean", "CA"],
          ["amount", "80"],
          ["that's why", "DR"]
        ]),
        scene("DH", [
          ["charge", "80"],
          ["mean", "HA or NE"],
          ["amount", "80"],
          ["that's why", "DH"]
        ]),
        scene("DD", [
          ["charge", "80"],
          ["mean", "DM, DO, DP, DS, DA, DG, DB, or DW"],
          ["amount", "0"],
          ["that's why", "DD"]
        ]),
        scene("DR", [
          ["mean", "DU"],
          ["amount", "80"],
          ["that's why", "DR"]
        ]),
        scene("DF", [
          ["no-charge or charge", "0"],
          ["that's why", "DF"]
        ])
      ]) +
      "</div>" +
      '<p class="src">80 is a sample amount. SFI: <span class="mono">sfi_p_u_drug_payment_payha2</span>. <a href="https://app.notion.com/p/3ad318e47d5080c198d2ec8b0120dd8e">Receipt note</a></p>';
    bindPicks(root);
  }

  function renderCharge() {
    var root = document.getElementById("view-charge");
    root.innerHTML =
      '<div class="charge-read">' +
      picks(["ep20", "$20"], ["ep5", "$5"], ["zero", "$0"], ["pa", "Waiver"], ["open", "Not collected"]) +
      "<h2>OPAS pay flag</h2>" +
      '<p class="pay-flag-note">Click a cell to edit it. Drag the arrow to change the order. A saved change is written to <span class="mono">notes/pay-flag.json</span>, so restarting this page server keeps it. <span id="pay-flag-status"></span></p>' +
      '<table class="pay-flag"><thead><tr><th></th><th>OPAS pay flag</th><th>FCS pay flag (to get charge_rate)</th><th>1U charge (display in frontend)</th><th>Service type</th><th>Remark</th></tr></thead><tbody id="pay-flag-body"></tbody></table>' +
      '<ol class="steps">' +
      "<li>The Pay Flag on the screen stays the OPAS letter. O is still shown as O.</li>" +
      "<li>Drug Charging Detail prices each line with the converted flag. O is read as S. EP1 at S is $20 a unit, so 1U is filled as 20. Two lines of 2U and one line of 1U are 40, 40, and 20, and the total charge is 100. The screen does this in DrugPaymentHandler.recalculateChargeAmt. fcs_p_s_charge_rate_nors_new uses the same conversion.</li>" +
      "<li>Not require to pay comes from code, not from fc_charge_rates. The attendance list prints FREE for O. The case is left uncollected only when there is no receipt yet, the payment means does not start with D, and the waiver amount is 0. That skip is fcs_p_s_os_catg_phs.</li>" +
      "<li>What the patient pays is the next step. With a 100% waiver the charge detail stays 100, the waiver amount is 100, and outstanding is 0. The waiver is separate from pay flag O. A waiver receipt already created is why the screen warns to cancel that receipt before changing the units.</li>" +
      "</ol>" +
      "<p>An empty pay code is looked up as EP1. Pay codes such as GS, HA, and P are $0 a unit, so 1U adds $0. EP4 and NE1–NE7, NE9, NEP, and TNE are $40 on pay flag F and $90 on S or Y.</p>" +
      rateSection() +
      "<h2>Waiver</h2>" +
      "<p>A waiver is not a pay flag. OPAS also sends a waiver reference and a percent. FCS still prices the line from the pay code and the pay flag used to get charge_rate, then takes the waiver off what the patient pays. In this calculation the percent is the share the patient still pays.</p>" +
      '<table><thead><tr><th>Case</th><th>Charge</th><th>Patient pays</th></tr></thead><tbody>' +
      row("ep20", "EP1, charge_rate pay flag S, no waiver", "$20", "$20") +
      row("pa", "Waiver reference, percent 0", "$20", "$0, the whole charge is waived") +
      row("pa", "Waiver reference, percent 50", "$20", "$10, and $10 is waived") +
      row("pa", "Pay code PA", "$20", "$0, the whole charge is waived") +
      "</tbody></table>" +
      "<p>Percent 0 is a full waive for an ordinary medical-social waiver. An A3 case does not treat percent 0 that way.</p>" +
      "<h2>Not collected</h2>" +
      '<p data-hit="open">OPAS pay flags N, O, P, and Q are left as not collected when there is no receipt yet, the payment means does not start with D, and the waiver amount is $0. A waiver amount takes the case out of that skip. OPAS pay flag P with means DT is saved as means DU and receipt DD.</p>' +
      '<p class="src">NSDCRATE supplied 3 Nov 2026. <a href="https://app.notion.com/p/40d318e47d508173a66bf5b8aaaac14b">Same note</a></p>' +
      "</div>";
    bindPicks(root);
    bindRates(root);
    bindPayFlag(root);
  }

  function payFlagDefaults() {
    return [
      { hit: "ep20", obsolete: false, cells: ["S", "S", "20", "SOPD (Specialist outpatient)", "Require to pay."] },
      { hit: "ep5", obsolete: false, cells: ["F", "F", "5", "FMOP (Family medicine)", "Require to pay."] },
      { hit: "ep20", obsolete: false, cells: ["O", "S", "20", "SOPD (Specialist outpatient)", "Not required to pay, as a full waiver."] },
      { hit: "ep5", obsolete: false, cells: ["P", "F", "5", "FMOP (Family medicine)", "Not required to pay, as a full waiver."] },
      { hit: "ep20", obsolete: false, cells: ["Y or blank", "Y", "20", "", "Require to pay."] },
      { hit: "ep20", obsolete: false, cells: ["N", "Y", "20", "", "Not require to pay as HA/GS, non charge case, or fully waiver case."] },
      { hit: "zero", obsolete: true, cells: ["G or Q", "G", "No G price supplied", "", "GOPC is obsoleted as combined with FMOP."] },
      { hit: "zero", obsolete: true, cells: ["X", "not used", "$0, and the screen stops", "", ""] }
    ];
  }

  function bindPayFlag(root) {
    var body = root.querySelector("#pay-flag-body");
    var status = root.querySelector("#pay-flag-status");
    var rows = payFlagDefaults();
    var dragFrom = null;
    var timer = null;
    function setStatus(text) { status.textContent = text; }
    function paint(list) {
      body.innerHTML = "";
      list.forEach(function (row) {
        var tr = document.createElement("tr");
        tr.setAttribute("data-hit", row.hit || "");
        if (row.obsolete) tr.className = "obsolete";
        var handle = document.createElement("td");
        handle.className = "drag";
        handle.textContent = "↕";
        handle.draggable = true;
        tr.appendChild(handle);
        (row.cells || []).forEach(function (text) {
          var td = document.createElement("td");
          td.contentEditable = "true";
          td.spellcheck = false;
          td.textContent = text || "";
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
    }
    function collect() {
      return Array.prototype.map.call(body.querySelectorAll("tr"), function (tr) {
        return {
          hit: tr.getAttribute("data-hit") || "",
          obsolete: tr.classList.contains("obsolete"),
          cells: Array.prototype.map.call(tr.querySelectorAll("td:not(.drag)"), function (td) { return td.textContent; })
        };
      });
    }
    function save() {
      setStatus("Saving.");
      fetch("/notes/pay-flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: collect() })
      }).then(function (res) {
        setStatus(res.ok ? "Saved. Restarting this page server keeps the table." : "Not saved.");
      }).catch(function () {
        setStatus("Not saved. The page server needs a restart before an edit can be kept.");
      });
    }
    function queue() {
      clearTimeout(timer);
      timer = setTimeout(save, 400);
    }
    body.addEventListener("input", queue);
    body.addEventListener("dragstart", function (e) {
      var handle = e.target.closest("td.drag");
      if (!handle) {
        e.preventDefault();
        return;
      }
      dragFrom = handle.parentNode;
      e.dataTransfer.effectAllowed = "move";
    });
    body.addEventListener("dragover", function (e) {
      if (!dragFrom) return;
      var tr = e.target.closest("tr");
      if (!tr || tr === dragFrom || tr.parentNode !== body) return;
      e.preventDefault();
      var rect = tr.getBoundingClientRect();
      body.insertBefore(dragFrom, e.clientY > rect.top + rect.height / 2 ? tr.nextSibling : tr);
    });
    body.addEventListener("drop", function (e) {
      if (!dragFrom) return;
      e.preventDefault();
      dragFrom = null;
      save();
    });
    body.addEventListener("dragend", function () { dragFrom = null; });
    paint(rows);
    fetch("/notes/pay-flag").then(function (res) { return res.json(); }).then(function (data) {
      if (data && data.saved && Array.isArray(data.rows) && data.rows.length) {
        rows = data.rows;
        paint(rows);
        setStatus("Loaded the saved table. Restarting this page server keeps it.");
      }
    }).catch(function () {});
  }

  function rateSection() {
    return "<h2>Charge rates</h2>" +
      "<p>QEH, drug service SDC. Same charge rate with the other hospitals that have the row, up to 12 Nov 2026. The table is the current row: latest effective date on or before that day, and not expired.</p>" +
      '<div class="rate-filters">' +
      '<label>Pay code<input id="rate-pay-cde" type="text" spellcheck="false" autocomplete="off"></label>' +
      '<label>Pay flag<input id="rate-pay-flag" type="text" spellcheck="false" autocomplete="off"></label>' +
      '<button type="button" id="rate-sql-btn" aria-expanded="false">Show SQL</button>' +
      '<span class="rate-count" id="rate-count"></span>' +
      "</div>" +
      '<pre class="sql" id="rate-sql" hidden></pre>' +
      '<table id="rate-table"><thead><tr><th>Pay code</th><th>Pay flag</th><th>Charge rate</th><th>Effective</th><th>Expiry</th></tr></thead><tbody></tbody></table>';
  }

  function bindRates(root) {
    var rates = window.QEH_SDC_RATES || [];
    var body = root.querySelector("#rate-table tbody");
    var count = root.querySelector("#rate-count");
    var code = root.querySelector("#rate-pay-cde");
    var flag = root.querySelector("#rate-pay-flag");
    var sql = root.querySelector("#rate-sql");
    var btn = root.querySelector("#rate-sql-btn");
    sql.textContent = RATE_SQL;
    function paint() {
      var c = code.value.trim().toUpperCase();
      var f = flag.value.trim().toUpperCase();
      var html = "";
      var n = 0;
      for (var i = 0; i < rates.length; i++) {
        var row = rates[i];
        if (c && String(row[0]).toUpperCase().indexOf(c) < 0) continue;
        if (f && String(row[1]).toUpperCase().indexOf(f) < 0) continue;
        n++;
        html += "<tr><td>" + row[0] + "</td><td>" + row[1] + "</td><td>" + row[2] + "</td><td>" + row[3] + "</td><td>" + (row[4] || "") + "</td></tr>";
      }
      body.innerHTML = html;
      count.textContent = n + " of " + rates.length;
    }
    code.addEventListener("input", paint);
    flag.addEventListener("input", paint);
    btn.addEventListener("click", function () {
      sql.hidden = !sql.hidden;
      var open = !sql.hidden;
      btn.textContent = open ? "Hide SQL" : "Show SQL";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    paint();
  }

  function row(hit, a, b, c, d, obsolete) {
    var remark = d === undefined ? "" : "<td>" + d + "</td>";
    var cls = obsolete ? ' class="obsolete"' : "";
    return '<tr data-hit="' + hit + '"' + cls + "><td>" + a + "</td><td>" + b + "</td><td>" + c + "</td>" + remark + "</tr>";
  }

  function picks() {
    var html = '<div class="picks">';
    for (var i = 0; i < arguments.length; i++) {
      html += '<button type="button" data-pick="' + arguments[i][0] + '">' + arguments[i][1] + "</button>";
    }
    return html + "</div>";
  }

  function chapter(title, scenes) {
    return '<section class="chapter"><h2>' + title + "</h2>" + scenes.join("") + "</section>";
  }

  function scene(hit, steps) {
    var html = '<article class="scene" data-hit="' + hit + '"><ol class="path">';
    for (var i = 0; i < steps.length; i++) {
      if (i) html += '<li class="go" aria-hidden="true">→</li>';
      var last = i === steps.length - 1;
      html += '<li class="' + (last ? "result" : "") + '"><span class="k">' + steps[i][0] + '</span><span class="v">' + steps[i][1] + "</span></li>";
    }
    return html + "</ol></article>";
  }

  function bindPicks(root) {
    var current = "";
    root.querySelector(".picks").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-pick]");
      if (!btn) return;
      var pick = btn.getAttribute("data-pick");
      current = current === pick ? "" : pick;
      root.querySelectorAll("[data-pick]").forEach(function (item) {
        item.classList.toggle("on", item.getAttribute("data-pick") === current);
      });
      root.querySelectorAll("[data-hit]").forEach(function (item) {
        var hits = item.getAttribute("data-hit").split(" ");
        var match = !current || hits.indexOf(current) >= 0;
        item.classList.toggle("hot", !!current && match);
        item.classList.toggle("dim", !!current && !match);
      });
    });
  }
})();
