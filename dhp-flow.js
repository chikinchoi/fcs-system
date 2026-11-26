(function () {
  var root = document.getElementById("view-dhp-flow");
  if (!root) return;

  var attn = [
    ["hospital", "hospital", "hospitalCode"],
    ["caseNo", "the case number", "the case number"],
    ["hkid", "blank", "sent only when it already has a value"],
    ["apptSeq", "0", "0"],
    ["duration", "7", "7"],
    ["patientNo / patientKey", "blank, unless a patient key is already on the payment", "sent only when it already has a value"],
    ["withPatient", "N", "Y"],
    ["userId", "FCS_USER when the default user is on, otherwise the login", "same"]
  ];
  var attnAgain = [
    ["hospital", "hospital", "hospitalCode"],
    ["caseNo", "not sent", "not sent"],
    ["hkid", "not sent", "not sent"],
    ["apptSeq", "the appointment sequence already stored", "same"],
    ["duration", "7", "7"],
    ["patientNo / patientKey", "sent when the payment has a patient key", "same"],
    ["withPatient", "N", "Y"]
  ];
  var attnDay = [
    ["hospital", "hospital", "hospitalCode"],
    ["caseNo", "the case number on the order", "same"],
    ["hkid", "blank", "blank"],
    ["apptSeq", "0", "0"],
    ["duration", "1", "1"],
    ["patientNo / patientKey", "blank", "blank"],
    ["withPatient", "N", "Y"]
  ];
  var attnHkid = [
    ["hospital", "hospital", "hospitalCode"],
    ["caseNo", "blank", "blank"],
    ["hkid", "left-padded with spaces to 9 characters", "same, and only when it has a value"],
    ["apptSeq", "0", "0"],
    ["duration", "7", "7"],
    ["patientNo / patientKey", "blank", "blank"],
    ["withPatient", "N", "Y"]
  ];
  var spec = [
    ["hospital", "hospital", "hospitalCode"],
    ["specialty", "blank", "specialtyList empty"],
    ["opasUnit / subSpecialty", "blank", "not sent"],
    ["statusList", "not sent", "A and O"],
    ["withPatient", "not sent", "not sent"],
    ["userId", "FCS_USER when the default user is on, otherwise the login", "same"]
  ];
  var unit = [
    ["hospital", "hospital", "hospitalCode"],
    ["specialty", "the specialty the cashier picked", "same"],
    ["opasUnit / subSpecialty", "blank", "blank"],
    ["showAll", "N", "not sent"],
    ["withPatient", "not sent", "not sent"]
  ];
  var patient = [
    ["hospital", "hospital", "hospitalCode"],
    ["which key is sent", "first appointment sequence, else patient key, else case number, else HKID", "same order"],
    ["caseNo", "blank when it starts with FC0", "same"],
    ["hkid", "left-padded to 9 when this is the key used", "sent only when this is the key used"],
    ["patientNo / patientKey", "sent when this is the key used. 0 is sent blank", "same, and 0 is omitted"],
    ["apptSeq", "sent when this is the key used", "same"],
    ["duration", "7", "7"],
    ["withPatient", "Y", "Y"]
  ];
  var eis = [
    ["hospital", "hospital", "hospitalCode"],
    ["specialty", "the specialty on the payment", "same"],
    ["opasUnit / subSpecialty", "the unit on the payment", "same"],
    ["withPatient", "not sent", "not sent"],
    ["called when", "both specialty and unit are filled", "same"]
  ];

  var screens = [
    {
      id: "drug-case",
      title: "Drug payment — case number",
      lead: "This is the path after the cashier types a case number. Patient info is not the next call. It runs later, when the payment screen opens.",
      steps: [
        step("1", "Cashier searches by case number.", "doCallSOPDAttn", "SOPD attendance · SOPD_ATTENDANCE_API", attn),
        step("2", "Only when that single row has no patient number. FCS pay search, key C, reads the patient key. That search is not OPAS. Attendance then runs again. A comment says the case number is cleared. The call still sends it.", "doCallSOPDAttn", "SOPD attendance · SOPD_ATTENDANCE_API", [
          ["hospital", "hospital", "hospitalCode"],
          ["caseNo", "the same case number", "the same case number"],
          ["patientNo / patientKey", "the patient key from the pay search", "same"],
          ["apptSeq", "0", "0"],
          ["duration", "7", "7"],
          ["withPatient", "N", "Y"]
        ]),
        note("3", "An appointment comes back", "apptSeq is at least 1. The attendance list stays on the screen. Specialty is not called. The canary shows SOPD attendance only."),
        step("4", "No appointment. The list is empty, or the only row has apptSeq below 1. Case number and patient key are kept. This call is in the same request, and the screen then shows the two dropdowns. The unit list is still empty.", "doCallSpec", "Specialty · doCallSpec_findSpecialty", spec),
        step("5", "Cashier picks a specialty. This is a new request. Loading the specialty dropdown does not do this.", "doCallSubSpec", "OPAS unit · doCallSubSpec_findOpasUnit", unit),
        step("6", "Cashier opens the payment, and an appointment sequence above 0 is already stored. Skip this step when there is no appointment.", "doCallSOPDAttn", "SOPD attendance · SOPD_ATTENDANCE_API", attnAgain),
        step("7", "Cashier opens the payment. This call always runs.", "doCallPatientInfo", "Patient info · SOPD_PATIENT_INFO_API", patient),
        step("8", "Cashier opens the payment, and both specialty and unit are filled. If either is blank, this call does not run and the pay flag is set to Y. The EIS pay flag is copied onto the payment only when there is no appointment sequence.", "doCallEis", "EIS · doCallEis_findOpasUnit", eis)
      ]
    },
    {
      id: "drug-hkid",
      title: "Drug payment — HKID",
      lead: "Same screen, search type HKID. There is no pay-search retry.",
      steps: [
        step("1", "Cashier searches by HKID.", "doCallSOPDAttn", "SOPD attendance · SOPD_ATTENDANCE_API", attnHkid),
        note("2", "The only row has no patient number", "The search stops as not found. It does not read a patient key and it does not call attendance again."),
        note("3", "An appointment comes back", "Same as the case-number path. The list stays. Specialty is not called."),
        step("4", "No appointment.", "doCallSpec", "Specialty · doCallSpec_findSpecialty", spec),
        step("5", "Cashier picks a specialty.", "doCallSubSpec", "OPAS unit · doCallSubSpec_findOpasUnit", unit),
        note("6", "Cashier opens the payment", "The next calls are the same as case-number steps 6, 7, and 8: attendance again only when an appointment sequence is stored, then patient info, then EIS when specialty and unit are both filled.")
      ]
    },
    {
      id: "drug-moe",
      title: "Drug payment — MOE, receipt, or service time",
      lead: "The search itself reads FCS. OPAS is called only when that order has no appointment sequence, and again when the payment screen opens.",
      steps: [
        step("1", "The order has no appointment sequence. A same-day attendance lookup runs. The row is kept only when it has a journal time.", "doCallSOPDAttn", "SOPD attendance · SOPD_ATTENDANCE_API", attnDay),
        step("2", "From the MOE attendance list, when the cashier asks for appointments. Duration is 7, by case number or by HKID. An empty list then calls doCallSpec.", "doCallSOPDAttn", "SOPD attendance · SOPD_ATTENDANCE_API", attn),
        note("3", "Cashier opens the payment", "The next calls are the same as case-number steps 6, 7, and 8.")
      ]
    },
    {
      id: "drug-skip",
      title: "Drug payment — do not associate",
      lead: "Checkbox on the attendance list. It does not call SOPD attendance.",
      steps: [
        note("1", "Cashier checks do not associate", "Appointment sequence becomes -1. Specialty, unit, slot, waiver, and charge are cleared. Pay code becomes EP1 and pay flag becomes Y. Case number and patient key stay."),
        step("2", "The specialty screen opens.", "doCallSpec", "Specialty · doCallSpec_findSpecialty", spec),
        step("3", "Cashier picks a specialty.", "doCallSubSpec", "OPAS unit · doCallSubSpec_findOpasUnit", unit),
        step("4", "Cashier opens the payment. Attendance is skipped because the sequence is not above 0.", "doCallPatientInfo, then doCallEis if specialty and unit are filled", "Patient info, then EIS", patient)
      ]
    },
    {
      id: "sfi",
      title: "SFI payment",
      lead: "Outpatient case numbers use the same OPAS methods. A case that starts with AE or HN does not call SOPD attendance.",
      steps: [
        step("1", "Cashier searches an outpatient case number. There is no second attendance call when the patient number is missing. That search says case not found.", "doCallSOPDAttn", "SOPD attendance · SOPD_ATTENDANCE_API", attn),
        step("2", "Cashier searches by HKID.", "doCallSOPDAttn", "SOPD attendance · SOPD_ATTENDANCE_API", attnHkid),
        step("3", "No appointment, and the case is not an inter-hospital local case. An inter-hospital local case uses the IP specialty list instead, which is not this OPAS call.", "doCallSpec", "Specialty · doCallSpec_findSpecialty", spec),
        step("4", "Invoice, receipt, or service time, and the SFI has no appointment sequence.", "doCallSOPDAttn", "SOPD attendance · SOPD_ATTENDANCE_API", attnDay),
        step("5", "Cashier checks do not associate.", "doCallSpec", "Specialty · doCallSpec_findSpecialty", spec),
        step("6", "Cashier picks a specialty.", "doCallSubSpec", "OPAS unit · doCallSubSpec_findOpasUnit", unit),
        step("7", "Cashier opens the SFI payment. Attendance runs again only when an appointment sequence is already stored.", "doCallSOPDAttn", "SOPD attendance · SOPD_ATTENDANCE_API", attnAgain),
        step("8", "The SFI payment then reloads the patient.", "doCallPatientInfo", "Patient info · SOPD_PATIENT_INFO_API", patient),
        step("9", "EIS runs when specialty and unit are both filled.", "doCallEis", "EIS · doCallEis_findOpasUnit", eis)
      ]
    },
    {
      id: "medd",
      title: "MEDD payment",
      lead: "The MEDD payment screen calls patient info when a MEDD charge number is present. It does not call SOPD attendance, specialty, or unit.",
      steps: [
        step("1", "Cashier opens the MEDD payment.", "doCallPatientInfoForMedd", "MEDD patient · SOPD_PATIENT_INFO_API_MEDD", [
          ["hospital", "hospital", "hospitalCode"],
          ["caseNo", "blank", "not sent"],
          ["hkid", "blank", "not sent"],
          ["patientNo / patientKey", "the MEDD patient key. 0 is sent blank", "sent when it is not 0"],
          ["apptSeq", "the MEDD appointment sequence", "same"],
          ["duration", "7", "7"],
          ["withPatient", "Y", "Y"]
        ])
      ]
    },
    {
      id: "mam",
      title: "MAM — amend chargeable unit",
      lead: "On the billing web app, a successful MOE or receipt search then calls MAM patient info. The newer core-service MAM screen still calls SOAP only, so that screen stays Not seen on the canary even when the flag is Y.",
      steps: [
        step("1", "The MOE or receipt search finds the order.", "doCallPatientInfoMAM", "MAM patient · SOPD_PATIENT_INFO_API_MAM", [
          ["hospital", "hospital", "hospitalCode"],
          ["caseNo", "the case number", "the case number, when it is not blank"],
          ["hkid", "blank", "not sent"],
          ["patientNo / patientKey", "blank", "not sent"],
          ["apptSeq", "0", "0"],
          ["duration", "0", "7. The new API rejects duration 0."],
          ["withPatient", "Y", "Y"]
        ])
      ]
    },
    {
      id: "pfms",
      title: "PFMS itemized charge",
      lead: "Attendance, patient info, and EIS on this screen still use the old stored procedure. They do not write _logSource. Specialty and unit do, through the same methods as drug payment.",
      steps: [
        note("1", "Cashier searches a case or a patient", "SOPD attendance here is the stored procedure. The canary does not get an SOPD attendance row from this screen."),
        step("2", "No appointment, or the cashier checks do not associate. The specialty list loads.", "doCallSpec", "Specialty · doCallSpec_findSpecialty", spec),
        step("3", "Cashier picks a specialty.", "doCallSubSpec", "OPAS unit · doCallSubSpec_findOpasUnit", unit)
      ]
    }
  ];

  root.innerHTML =
    '<div class="health-page">' +
    '<div class="dash-top"><h1>DHP screen flows</h1>' +
    '<p class="src">Each block is one way a cashier reaches an OPAS call. Read it top to bottom. A highlighted row is a value that is not the same on the old SOAP call and the new REST call. The canary name is the row on the DHP canary page.</p></div>' +
    sharedChart() +
    '<nav class="flow-jump">' + screens.map(function (screen) {
      return '<a href="#flow-' + screen.id + '">' + esc(screen.title) + "</a>";
    }).join("") + "</nav>" +
    screens.map(renderScreen).join("") +
    "</div>";

  function sharedChart() {
    return '<section class="health-panel" id="flow-shared"><h2>Same steps on both flags</h2>' +
      '<p class="src">The cashier actions and the Java method at each step are the same when the flag is N and when it is Y. The flag is read inside the method and chooses SOAP or REST. It does not choose the next step. If the new call fails, that method returns empty and does not fall back to SOAP. The response can still differ: attendance with withPatient Y brings patient fields back inside that reply, and the payment screen still calls doCallPatientInfo afterwards.</p>' +
      '<ol class="chart">' +
      box("Search by case number", "Same screen action. HKID, MOE, SFI, and do-not-associate are other entries into the same methods.") +
      callBox("doCallSOPDAttn", "SOAP withPatient N", "REST withPatient Y") +
      box("What came back", "An appointment keeps the list. No patient number runs an FCS pay search, then this attendance call again. No appointment calls doCallSpec. None of those choices read the flag.") +
      callBox("doCallSpec", "SOAP specialty", "REST findSpecialty, statusList A and O") +
      box("Cashier picks a specialty", "A later request. The specialty dropdown does not load the unit list.") +
      callBox("doCallSubSpec", "SOAP showAll N", "REST findOpasUnit, showAll not sent") +
      box("Cashier opens the payment", "Attendance again only when an appointment sequence is already stored. Then patient info. Then EIS when specialty and unit are both filled.") +
      callBox("doCallPatientInfo", "SOAP withPatient Y", "REST withPatient Y") +
      callBox("doCallEis", "SOAP specialty and unit", "REST findOpasUnit, same two fields") +
      "</ol>" +
      '<p class="src">Other input changes, same step: MAM duration is 0 on SOAP and 7 on REST, because the new API rejects 0. MEDD withPatient is Y on both. The core-service MAM screen never reads the flag, so it stays on SOAP.</p></section>';
  }

  function box(title, text) {
    return '<li><strong>' + esc(title) + "</strong><span>" + esc(text) + "</span></li>";
  }

  function callBox(method, oldSide, newSide) {
    return '<li class="chart-call"><strong>' + esc(method) + "</strong>" +
      '<span class="chart-fork"><em>Flag N</em> ' + esc(oldSide) + "<em>Flag Y</em> " + esc(newSide) + "</span></li>";
  }

  function step(n, user, method, canary, rows) {
    return { n: n, user: user, method: method, canary: canary, rows: rows };
  }

  function note(n, user, text) {
    return { n: n, user: user, text: text };
  }

  function renderScreen(screen) {
    return '<section class="health-panel" id="flow-' + screen.id + '"><h2>' + esc(screen.title) + "</h2>" +
      '<p class="src">' + esc(screen.lead) + "</p>" +
      '<ol class="user-flow">' + screen.steps.map(renderStep).join("") + "</ol></section>";
  }

  function renderStep(item) {
    var head = '<li><p class="flow-user"><span>' + esc(item.n) + "</span> " + esc(item.user) + "</p>";
    if (item.text) return head + '<p class="flow-note">' + esc(item.text) + "</p></li>";
    return head +
      '<p class="flow-method">' + esc(item.method) + ' <span class="flow-tag">' + esc(item.canary) + "</span></p>" +
      paramTable(item.rows) + "</li>";
  }

  function paramTable(rows) {
    var body = rows.map(function (row) {
      var watch = { withPatient: 1, duration: 1, statusList: 1, showAll: 1 };
      var diff = watch[row[0]] && row[1] !== row[2];
      return '<tr' + (diff ? ' class="diff"' : "") + "><th>" + esc(row[0]) + "</th><td>" + esc(row[1]) + "</td><td>" + esc(row[2]) + "</td></tr>";
    }).join("");
    return '<table class="param-table"><thead><tr><th>Parameter</th><th>Old SOAP, flag N</th><th>New REST, flag Y</th></tr></thead><tbody>' + body + "</tbody></table>";
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch];
    });
  }
})();
