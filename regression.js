(function () {
  var NOTE = "HA / FCS / Web Services";
  var SHEET = "HA / FCS / Web Services / KIOSK_GENERIC_WSS";
  var ENVS = {
    generic: [
      ["SIT", "http://eaptst72a:14495/fcs", NOTE],
      ["UAT", "http://eaptst72e:26495/fcs", NOTE],
      ["FPS", "http://eaptst72g:23495/fcs", NOTE],
      ["PRD", "http://eapsrv76a:32495/fcs", NOTE],
      ["PRD DNS", "http://fcs-corp-prd.server.ha.org.hk:32495/fcs", NOTE]
    ],
    payha: [
      ["SIT", "http://eaptst72a:14497/payha", NOTE],
      ["UAT", "http://eaptst72e:26497/payha", NOTE],
      ["FPS", "http://eaptst72g:23497/payha", NOTE],
      ["PRD", "http://eapsrv76a:32497/payha", NOTE],
      ["PRD DNS", "http://fcs-corp-prd.server.ha.org.hk:32497/payha", NOTE],
      ["PRD list", "https://fcs-corp-hapay-prd.server.ha.org.hk:34497/payha", SHEET]
    ],
    kiosk: [
      ["SIT", "http://eaptst72a:14496/kiosk", NOTE],
      ["UAT", "http://eaptst72e:26496/kiosk", NOTE],
      ["FPS", "http://eaptst72g:23496/kiosk", NOTE],
      ["PRD", "http://eapsrv76a:32496/kiosk", NOTE],
      ["PRD DNS", "http://fcs-corp-prd.server.ha.org.hk:32497/kiosk", NOTE],
      ["PRD list", "https://fcs-corp-prd.server.ha.org.hk:34496/kiosk", SHEET]
    ],
    frontend: [
      ["SIT", "https://fcs-corp-sit.server.ha.org.hk:16495", NOTE],
      ["UAT", "https://fcs-corp-uat.server.ha.org.hk:28495", NOTE],
      ["FPS", "https://fcs-corp-fps.server.ha.org.hk:25495", NOTE],
      ["PRD DNS", "https://fcs-corp-prd.server.ha.org.hk:34495", NOTE]
    ]
  };

  var APIS = [
    api("generic", "gen-search", "Drug pay search", "POST", "/fcsPSDrugPaySearchPms", true, true,
      "Reads fcs_p_s_drug_pay_search_pms by MOE order.",
      function (k) {
        return { hospitalCode: k.hospital, inSearchKey: "M", inMoe: k.moe };
      },
      ["hospital", "moe"]),
    api("generic", "gen-clear", "Check MOE clearance", "POST", "/fcsPSChkClearMoe", true, true,
      "Reads fcs_p_s_chk_clear_moe. Appointment sequence 0 is a placeholder; edit it when the check needs the real sequence.",
      function (k) {
        return { hospitalCde: k.hospital, moeOrderNo: k.moeNum, opasApptSeq: 0 };
      },
      ["hospital", "moeNum"]),
    api("generic", "gen-clear-pms", "Check MOE clearance for PMS", "POST", "/fcsPSChkClearMoePms", true, true,
      "Reads fcs_p_s_chk_clear_moe_pms. Y means cleared.",
      function (k) {
        return { hospitalCode: k.hospital, moeOrderNo: k.moeNum, opasApptSeq: 0 };
      },
      ["hospital", "moeNum"]),
    api("generic", "gen-clearance", "Check clearance", "POST", "/fcsPSCheckClearance", true, false,
      "Reads fcs_p_s_check_clearance for the same hospital, MOE order, and appointment sequence.",
      function (k) {
        return { hospitalCde: k.hospital, moeOrderNo: k.moeNum, opasApptSeq: 0 };
      },
      ["hospital", "moeNum"]),
    api("generic", "gen-chk-pay", "Check drug payment for PMS", "POST", "/fcsPChkDrugPaymentPms", true, false,
      "Reads through the drug pay search. Needs the PI key.",
      function (k) {
        return { inPiKey: k.pi, inFcHosp: k.hospital, inMoeOrderNo: k.moe };
      },
      ["hospital", "moe", "pi"]),

    api("payha", "payha-search", "Search drug payment", "POST", "/postAudit/searchDrugPaymentPayha/{hospital}", true, true,
      "Reads fcs_p_s_drug_pay_search_payha. The list is hospital, search key M, MOE order. If the SDC backup plan is on and the order is missing, this action can retry a CMS sync.",
      function (k) {
        return [k.hospital, "M", k.moe];
      },
      ["hospital", "moe"]),
    api("payha", "payha-sfi", "Search SFI drug payment", "POST", "/postAudit/searchSFIDrugPaymentPayha/{hospital}", true, false,
      "Reads the SFI payment search. Fill the SFI number and edit the search key before running.",
      function (k) {
        return [k.hospital, "", k.sfi];
      },
      ["hospital", "sfi"]),
    api("payha", "payha-pi", "Patient info by PI key", "POST", "/postAudit/getPatientInfoByPiKey/{hospital}", true, false,
      "Reads patient info. The list is hospital, then PI key.",
      function (k) {
        return [k.hospital, k.pi];
      },
      ["hospital", "pi"]),
    api("payha", "payha-receipt", "Retrieve drug receipt", "POST", "/postAudit/retrieveDrugReceipt/{hospital}", true, false,
      "Reads fcs_p_s_drug_receipt_payha, asks OPAS for the patient name, and returns a PDF. It does not save a payment. The list is hospital, PI key, receipt no., case no., PDF password. Fill the receipt number and password in the request before running.",
      function (k) {
        return [k.hospital, k.pi, "", k.caseNo, ""];
      },
      ["hospital", "pi", "caseNo"]),
    api("payha", "payha-sfi-receipt", "Retrieve SFI drug receipt", "POST", "/postAudit/retrieveSFIDrugReceipt/{hospital}", true, false,
      "Reads the SFI receipt, asks OPAS for the patient name, and returns a PDF. It does not save a payment. The list is hospital, PI key, receipt no., case no., PDF password. Fill the receipt number and password before running.",
      function (k) {
        return [k.hospital, k.pi, "", k.caseNo, ""];
      },
      ["hospital", "pi", "caseNo"]),
    api("payha", "payha-os-moe", "Outstanding MOE list", "POST", "/postAudit/searchOutstandingMOEList/{hospital}", true, false,
      "Reads fcs_p_s_outstanding_moe_list. The list is the patient id.",
      function (k) { return [k.pi]; },
      ["pi"]),
    api("payha", "payha-os-moe-d", "Outstanding MOE detail", "POST", "/postAudit/searchOutstandingMOEDetail/{hospital}", true, false,
      "Reads fcs_p_s_outstanding_moe_detail. The list is patient id, hospital, MOE order.",
      function (k) { return [k.pi, k.hospital, k.moe]; },
      ["pi", "hospital", "moe"]),
    api("payha", "payha-os-sfi", "Outstanding SFI list", "POST", "/postAudit/searchOutstandingSFIList/{hospital}", true, false,
      "Reads sfi_p_s_outstanding_sfi_list. The list is the patient id.",
      function (k) { return [k.pi]; },
      ["pi"]),
    api("payha", "payha-os-sfi-d", "Outstanding SFI detail", "POST", "/postAudit/searchOutstandingSFIDetail/{hospital}", true, false,
      "Reads sfi_p_s_outstanding_sfi_detail. The list is patient id, hospital, SFI no.",
      function (k) { return [k.pi, k.hospital, k.sfi]; },
      ["pi", "hospital", "sfi"]),
    api("payha", "payha-history", "Patient payment history", "POST", "/postAudit/getPatientPaymentHistory/{hospital}", true, false,
      "Reads payment history. The list is patient key, from time, to time. Fill the two times before running.",
      function (k) { return [k.pi, "", ""]; },
      ["pi"]),
    api("payha", "payha-push-moe", "MOE rows for push", "POST", "/postAudit/retrieveMoeForPush/{hospital}", true, false,
      "Reads MOE rows for a time range. It does not mark them sent. Fill the from and to times.",
      function () { return ["", ""]; },
      []),
    api("payha", "payha-push-sfi", "SFI rows for push", "POST", "/postAudit/retrieveSFIForPush/{hospital}", true, false,
      "Reads SFI rows for a time range. It does not mark them sent. Fill the from and to times.",
      function () { return ["", ""]; },
      []),
    api("payha", "payha-sfccf", "Check SF CCF", "POST", "/postAudit/checkSFCCF/{hospital}", true, false,
      "Reads fcs_p_s_check_sf_ccf. The list is SFI no., invoice time, HKID. Fill all three before running.",
      function () { return ["", "", ""]; },
      []),
    api("payha", "payha-medd-clear", "Check MEDD clearance", "POST", "/postAudit/checkMeddClearance/{hospital}", true, false,
      "Reads status and txn status from fc_payha_drug_delivery_txns. The list is the MEDD charge number.",
      function () { return [""]; },
      []),
    api("payha", "payha-medd-receipt", "Retrieve MEDD receipt", "POST", "/postAudit/retrieveMeddReceipt/{hospital}", true, false,
      "Returns a MEDD receipt PDF and does not save a payment. The list is patient hospital, patient key, receipt no., password, image flag, reprint flag. Fill the receipt number and password before running.",
      function (k) { return [k.hospital, k.pi, "", "", "", ""]; },
      ["hospital", "pi"]),
    api("payha", "payha-chk", "Check drug payment", "POST", "/postAudit/checkDrugPaymentPayha/{hospital}", true, false,
      "Reads fcs_p_chk_drug_payment_payha and asks ASC about the waiver. It does not save. The list is the payment fields, so edit it before running.",
      function () { return []; },
      []),

    api("kiosk", "kiosk-search", "Drug pay search", "POST", "/postAudit/drugPaySearch/{hospital}", true, true,
      "Reads the kiosk drug pay search. The list is hospital, search key M, MOE order. Edit the list if this procedure wants more arguments.",
      function (k) {
        return [k.hospital, "M", k.moe];
      },
      ["hospital", "moe"]),
    api("kiosk", "kiosk-order", "Drug order search", "POST", "/postAudit/drugOrderSearch/{hospital}", true, false,
      "Reads fcs_p_s_drug_order_kiosk. Needs the PI key.",
      function (k) {
        return [k.hospital, k.pi, "", "U"];
      },
      ["hospital", "pi"]),
    api("kiosk", "kiosk-sfi", "SFI order search", "POST", "/postAudit/sfiOrderSearch/{hospital}", true, false,
      "Reads sfi_p_s_drug_payment_payha. Fill the SFI number first.",
      function (k) {
        return [k.hospital, "", k.sfi];
      },
      ["hospital", "sfi"]),
    api("kiosk", "kiosk-rate", "Charge rate", "POST", "/postAudit/drugChargeRateRetrieval/{hospital}", true, false,
      "Reads the kiosk charge rate. Edit the service code before running.",
      function (k) {
        return [k.hospital, ""];
      },
      ["hospital"]),
    api("kiosk", "kiosk-order2", "Drug order search 2", "POST", "/postAudit/drugOrderSearch2/{hospital}", true, false,
      "Reads fcs_p_s_drug_order_kiosk2. The list is hospital, PI key, HKID, flag. Fill the HKID when the search needs it.",
      function (k) { return [k.hospital, k.pi, "", "U"]; },
      ["hospital", "pi"]),
    api("kiosk", "kiosk-chk", "Check drug payment", "POST", "/postAudit/checkDrugPayment/{hospital}", true, false,
      "Reads fcs_p_chk_drug_payment_kiosk. It checks and does not save. The list is the payment fields, so edit it before running.",
      function () { return []; },
      []),
    api("kiosk", "kiosk-chk-sfi", "Check SFI payment", "POST", "/postAudit/checksfiPayment/{hospital}", true, false,
      "Reads sfi_p_s_chk_payment_payha. It is the precheck, not the save. The list is the payment fields, so edit it before running.",
      function () { return []; },
      []),

    api("frontend", "fe-hosp", "Hospital list", "POST", "/getPbrcHospitalList", true, true,
      "Reads the hospital list. The frontend still expects a login cookie.",
      function () { return {}; },
      []),
    api("frontend", "fe-search", "Search drug payment", "POST", "/searchDrugPayment", true, true,
      "Reads the shroff drug search by MOE order. The frontend still expects a login cookie.",
      function (k) {
        return {
          hospitalCode: k.hospital,
          searchKey: "SEARCH_BY_MOE_ORDER_NO",
          caseNo: k.caseNo,
          moeOrder: k.moe
        };
      },
      ["hospital", "moe"]),
    api("frontend", "fe-orders", "Order list", "POST", "/getOrderList", true, false,
      "Reads the order list for the case. Flag A splits settled and unsettled.",
      function (k) {
        return { hospitalCode: k.hospital, caseNo: k.caseNo, piKey: k.pi, flag: "A" };
      },
      ["hospital", "caseNo"]),
    api("frontend", "fe-get", "Get drug payment", "POST", "/getDrugPayment", true, false,
      "Reads fcs web pay search 191 for one order. The screen must already be logged in.",
      function (k) {
        return { hospitalCode: k.hospital, searchKey: "SEARCH_BY_MOE_ORDER_NO", moeOrder: k.moe, caseNo: k.caseNo };
      },
      ["hospital", "moe", "caseNo"]),
    api("frontend", "fe-attn", "Attend history", "POST", "/getAttendHistory", true, false,
      "Reads attendance history for the case. The screen must already be logged in.",
      function (k) {
        return { hospitalCode: k.hospital, searchKey: "SEARCH_BY_CASE_NO", caseNo: k.caseNo };
      },
      ["hospital", "caseNo"]),
    api("frontend", "fe-attn-list", "Attendance list", "POST", "/getAttendanceList", true, false,
      "The path is on the shroff screen. The service currently returns an empty success and does not query.",
      function (k) { return { hospitalCode: k.hospital, caseNo: k.caseNo }; },
      ["hospital", "caseNo"]),
    api("frontend", "fe-amend", "Amend log", "POST", "/getAmendLog", true, false,
      "Reads fcs_p_s_drug_order_amend. The screen must already be logged in.",
      function (k) { return { hospitalCode: k.hospital, caseNo: k.caseNo }; },
      ["hospital", "caseNo"]),
    api("frontend", "fe-pay-list", "Payment list", "POST", "/getPaymentList", true, false,
      "Reads fcs_web_p_s_payment_list_134. Command S is the list. The screen must already be logged in.",
      function (k) { return { hospitalCode: k.hospital, caseNo: k.caseNo, cmd: "S" }; },
      ["hospital", "caseNo"]),
    api("frontend", "fe-cutoff-list", "Cutoff list", "POST", "/getCutoffList", true, false,
      "Reads the cutoff list. Command i is the list. The cutoff action itself stays on Do not run.",
      function () { return { cmd: "i", isUserCutOff: "N" }; },
      []),
    api("frontend", "fe-waiver", "Waiver info", "POST", "/drugpayment/getWaiverInfo", true, false,
      "Asks MSW for waiver info and does not save a payment. Fill the HKID before running. The screen must already be logged in.",
      function () { return { fcsPatientHkid: "", fcsServiceDatetime: "" }; },
      []),
    api("frontend", "fe-show", "Show drug payment", "POST", "/drugpayment/showDrugPayment", true, false,
      "Reads the shroff payment screen. Leave delink false so this call only reads.",
      function (k) {
        return { hospitalCode: k.hospital, caseNo: k.caseNo, searchType: "SEARCH_BY_MOE_ORDER_NO", moeOrder: k.moe, delink: false };
      },
      ["hospital", "caseNo", "moe"]),
    api("frontend", "fe-sfi-search", "Search SFI payment", "POST", "/searchSfiDrugPayment", true, false,
      "Reads the SFI payment search. The screen must already be logged in.",
      function (k) {
        return { sfiHospitalCode: k.hospital, sfiNo: k.sfi, searchType: "SEARCH_BY_SFI_INVOICE" };
      },
      ["hospital", "sfi"]),
    api("frontend", "fe-sfi-show", "Show SFI payment", "POST", "/sfi/showSfiPayment", true, false,
      "Reads the SFI payment screen. Keep delink false.",
      function (k) {
        return { sfiHospitalCode: k.hospital, sfiNo: k.sfi, sfiCaseNo: k.caseNo, searchType: "SEARCH_BY_SFI_INVOICE", delink: false };
      },
      ["hospital", "sfi", "caseNo"]),
    api("frontend", "fe-sfi-info", "SFI drug payment info", "POST", "/sfi/getDrugPaymentInfo", true, false,
      "Reads SFI drug payment info. The screen must already be logged in.",
      function (k) {
        return { sfiHospitalCode: k.hospital, sfiNo: k.sfi, sfiCaseNo: k.caseNo, searchType: "SEARCH_BY_SFI_INVOICE" };
      },
      ["hospital", "sfi"]),
    api("frontend", "fe-sfi-list", "SFI payment list", "POST", "/sfi/getPaymentList", true, false,
      "Reads sfi_web_p_s_payment_list_132. The screen must already be logged in.",
      function (k) { return { sfiHospitalCode: k.hospital, sfiCaseNo: k.caseNo }; },
      ["hospital", "caseNo"]),
    api("frontend", "fe-sfi-amend", "SFI amend log", "POST", "/sfi/getAmendLog", true, false,
      "Reads sfi_p_s_drug_amend_log_52. The screen must already be logged in.",
      function (k) { return { sfiHospitalCode: k.hospital, sfiCaseNo: k.caseNo }; },
      ["hospital", "caseNo"]),
    api("frontend", "fe-sfi-rcpt", "SFI receipt exists", "POST", "/sfi/checkReceiptExist", true, false,
      "Reads sfi_p_s_chk_deferred_payment. Fill the payment mean before running.",
      function (k) { return { inHospCode: k.hospital, inCaseNo: k.caseNo, payMean: "" }; },
      ["hospital", "caseNo"])
  ];

  var BLOCKED = [
    block("generic", "/fcsPUPayhaCreateSdc", "Creates the PayHA SDC charge."),
    block("generic", "/FcsPUBatchGenRcpt", "Generates receipts."),
    block("generic", "/syncSdcDataFromCms", "Writes SDC rows from CMS."),
    block("generic", "/fcsPUProcessF6", "Updates F6."),
    block("generic", "/fcsPUF6BatchProcess", "Updates F6 in a batch."),
    block("generic", "/fcsPUUpdPatientStatus", "Updates patient status."),
    block("generic", "/sfiPUUpdPatientStatus", "Updates SFI patient status."),
    block("generic", "/fcsPUUnconfirmEcs", "Updates an unconfirmed ECS record."),
    block("generic", "/fcsPUUnconfirmEcsUpd", "Updates an unconfirmed ECS record."),
    block("generic", "/amendOrder", "Amends an order."),
    block("generic", "/createSfi", "Creates an SFI."),
    block("generic", "/payhaCreateSfi", "Creates a PayHA SFI."),
    block("generic", "/sfiPURecheckDispense", "Rechecks and updates dispense."),
    block("generic", "/fcsWebPUDrugPayment131", "Saves a drug payment."),
    block("generic", "/sfiWebPUDrugPayment", "Saves an SFI payment."),
    block("generic", "/sfiWebPSDrugPayment191", "Saves an SFI payment."),
    block("generic", "/sfiPBatchUpload52", "Uploads a batch."),
    block("generic", "/renameticket", "Renames a ticket."),
    block("generic", "/pharmticket", "Writes a pharmacy ticket."),
    block("generic", "/fcsPSDrugOrderKiosk", "Deletes and rewrites temporary order rows before it returns the list."),
    block("generic", "/connTest/{action}", "The connection test carries a client secret. This page does not send it."),
    block("payha", "/postAudit/saveDrugPaymentPayha/{hospital}", "Saves a drug payment."),
    block("payha", "/postAudit/saveSFIDrugPaymentPayha/{hospital}", "Saves an SFI payment."),
    block("payha", "/postAudit/saveSFIDrugPaymentPayha2/{hospital}", "Saves an SFI payment."),
    block("payha", "/postAudit/insertHkid/{hospital}", "Writes an HKID link."),
    block("payha", "/postAudit/saveMeddPayment/{hospital}", "Saves a MEDD payment."),
    block("payha", "/postAudit/saveMeddPaymentPayha/{hospital}", "Saves a MEDD payment."),
    block("payha", "/postAudit/updateMeddStatus/{hospital}", "Updates MEDD status."),
    block("payha", "/postAudit/getMeddOrderDetailPayha/{hospital}", "Writes a row to fc_payha_drug_delivery_log."),
    block("payha", "/postAudit/checkMeddPaymentPayha/{hospital}", "Calls the MEDD gateway with a client secret, then writes a delivery log. This page does not send it."),
    block("kiosk", "/postAudit/saveDrugPayment/{hospital}", "Saves a kiosk drug payment."),
    block("kiosk", "/postAudit/savesfiPayment/{hospital}", "Saves a kiosk SFI payment."),
    block("kiosk", "/postAudit/savesfiPayment2/{hospital}", "Saves a kiosk SFI payment."),
    block("kiosk", "/postAudit/drugMachineStatus/{hospital}", "Updates kiosk machine status."),
    block("frontend", "/drugpayment/savePayment", "Saves a drug payment."),
    block("frontend", "/saveAttendace", "Saves attendance."),
    block("frontend", "/cancelReceipt", "Cancels a receipt."),
    block("frontend", "/cutoff", "Runs cutoff."),
    block("frontend", "/reprintReceipt", "Writes a reprint log."),
    block("frontend", "/saveOpasSpec", "The path is a save. The service currently returns an empty success."),
    block("frontend", "/drugPaymentDelink", "Calls fcs_p_u_moe_auto_delink."),
    block("frontend", "/drugpayment/saveOctopusPayment", "Saves an Octopus payment."),
    block("frontend", "/drugpayment/saveOctopusPaymentBegin", "Starts an Octopus payment."),
    block("frontend", "/drugPayment/saveCreditCardPayment", "Saves a credit-card payment."),
    block("frontend", "/drugPayment/saveCreditCardPaymentBegin", "Starts a credit-card payment."),
    block("frontend", "/drugPayment/saveWechatPayPayment", "Saves a WeChat payment."),
    block("frontend", "/drugPayment/saveWechatPayPaymentBegin", "Starts a WeChat payment."),
    block("frontend", "/drugPayment/saveAlipayHkPayment", "Saves an AlipayHK payment."),
    block("frontend", "/drugPayment/saveAlipayHkPaymentBegin", "Starts an AlipayHK payment."),
    block("frontend", "/initComm", "Talks to the Octopus reader."),
    block("frontend", "/portClose", "Closes the Octopus reader port."),
    block("frontend", "/octopusCancel", "Cancels the Octopus reader."),
    block("frontend", "/sfi/savePayment", "Saves an SFI payment."),
    block("frontend", "/sfi/cancelReceipt", "Cancels an SFI receipt."),
    block("frontend", "/sfi/reprintReceipt", "Writes an SFI reprint."),
    block("frontend", "/sfi/saveOctopusPayment", "Saves an SFI Octopus payment."),
    block("frontend", "/sfi/saveOctopusPaymentBegin", "Starts an SFI Octopus payment."),
    block("frontend", "/sfi/saveCreditCardPayment", "Saves an SFI credit-card payment."),
    block("frontend", "/sfi/saveCreditCardPaymentBegin", "Starts an SFI credit-card payment."),
    block("frontend", "/sfi/saveWechatPayPayment", "Saves an SFI WeChat payment."),
    block("frontend", "/sfi/saveWechatPayPaymentBegin", "Starts an SFI WeChat payment."),
    block("frontend", "/sfi/saveAlipayHkPayPayment", "Saves an SFI AlipayHK payment."),
    block("frontend", "/sfi/saveAlipayHkPaymentBegin", "Starts an SFI AlipayHK payment."),
    block("frontend", "/sfi/saveOctopusLogPoll", "Writes an Octopus poll log."),
    block("frontend", "/sfi/saveOctopusLogFail", "Writes an Octopus fail log."),
    block("frontend", "/sfi/updateLoactionIdLog", "Updates a location log."),
    block("frontend", "/sfi/initComm", "Talks to the Octopus reader."),
    block("frontend", "/sfi/portClose", "Closes the Octopus reader port."),
    block("frontend", "/sfi/octopusCancel", "Cancels the Octopus reader.")
  ];

  var root = document.getElementById("view-regression");
  var moduleId = "generic";
  var openId = "";
  var edited = {};
  var results = loadResults();
  var LOG_KEY = "fcs-system:reg:call-log";
  var logs = loadLogs();
  var openLog = -1;

  render();
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  document.getElementById("view-log").addEventListener("click", onLogClick);
  window.fcsRegression = {
    show: function (id) {
      if (!ENVS[id] || (id === moduleId && document.getElementById("reg-safe"))) return;
      saveFields();
      moduleId = id;
      openId = "";
      render();
    },
    showLog: renderLog
  };

  var shownGroup = "";

  function render() {
    var base = baseValue();
    shownGroup = currentGroup(base);
    var fx = readFixture(shownGroup);
    root.innerHTML =
      '<p class="reg-lead">After a deployment, run the checked reads. Save and update calls stay listed, and this page does not send them. Addresses are from the <a href="https://app.notion.com/p/2d1318e47d508081bcdaedb262c78b9b">Web Services note</a>. Kiosk and PayHA also have the later production host from the <a href="https://app.notion.com/p/296318e47d508098a60ecc906d362dcd">kiosk list</a>.</p>' +
      '<div class="reg-fields">' +
      envField(base) +
      field("reg-base", "Base URL", base, "url wide", "") +
      field("reg-hospital", "Hospital", fx.hospital, "short", "VH") +
      field("reg-case", "Case no.", fx.case, "short", "SOPD2526037T") +
      field("reg-moe", "MOE order", fx.moe, "short", "260012611") +
      field("reg-pi", "PI key", fx.pi, "short", "") +
      field("reg-sfi", "SFI no.", fx.sfi, "short", "") +
      "</div>" +
      '<p class="reg-note">These values stay with the environment, on every module. A request uses only the ones it needs. SIT, UAT, and FPS each keep their own set. Production hosts share one set. Check the database if a value may have gone.</p>' +
      '<div class="reg-actions">' +
      '<button type="button" class="primary" id="reg-run">Run request</button>' +
      '<button type="button" id="reg-clear">Clear results</button>' +
      "</div>" +
      '<div class="reg-split">' +
      '<div class="reg-main">' +
      '<h2 class="reg-chapter">Requests</h2>' +
      '<div id="reg-safe"></div>' +
      '<h2 class="reg-chapter">Do not run</h2>' +
      '<div id="reg-blocked"></div>' +
      "</div>" +
      '<aside class="reg-score">' +
      '<h2 class="reg-chapter">Results</h2>' +
      board() +
      '<div id="reg-score"></div>' +
      "</aside></div>";

    paintLists();
  }

  function onLogClick(e) {
    if (e.target.id === "log-clear") {
      logs = [];
      openLog = -1;
      localStorage.setItem(LOG_KEY, "[]");
      renderLog();
      return;
    }
    var row = e.target.closest("[data-log]");
    if (!row) return;
    var index = Number(row.getAttribute("data-log"));
    openLog = openLog === index ? -1 : index;
    renderLog();
  }

  function onClick(e) {
    var open = e.target.closest("[data-open]");
    var one = e.target.closest("[data-one]");
    var copy = e.target.closest("[data-curl]");
    var reset = e.target.closest("[data-reset]");
    var judgeBtn = e.target.closest("[data-judge]");
    if (e.target.id === "reg-run") {
      runChecked();
    } else if (e.target.id === "reg-clear") {
      results = {};
      saveResults();
      paintLists();
    } else if (open) {
      openId = openId === open.getAttribute("data-open") ? "" : open.getAttribute("data-open");
      paintLists();
      revealOpen();
    } else if (one) {
      runOne(findApi(one.getAttribute("data-one")));
    } else if (copy) {
      copyCurl(findApi(copy.getAttribute("data-curl")));
    } else if (reset) {
      delete edited[reset.getAttribute("data-reset")];
      paintLists();
    } else if (judgeBtn) {
      judgePasted(findApi(judgeBtn.getAttribute("data-judge")));
    }
  }

  function onInput(e) {
    var box = e.target.closest("[data-body]");
    if (!box) return;
    var id = box.getAttribute("data-body");
    edited[id] = box.value;
    var item = findApi(id);
    var pre = root.querySelector('[data-curl-view="' + id + '"]');
    if (item && pre) pre.textContent = curlOf(item, readKeys());
  }

  function onChange(e) {
    var check = e.target.closest("[data-check]");
    if (check) {
      var item = findApi(check.getAttribute("data-check"));
      if (item) item.checked = check.checked;
      var boardEl = root.querySelector(".reg-board");
      if (boardEl) boardEl.outerHTML = board();
      return;
    }
    if (e.target.id === "reg-env" || e.target.id === "reg-base") {
      if (e.target.id === "reg-env" && e.target.value) setVal("reg-base", e.target.value);
      syncEnvSelect();
      var next = currentGroup(baseValue());
      if (next !== shownGroup) {
        saveFixture(shownGroup);
        shownGroup = next;
        loadFixture(shownGroup);
      }
      saveFields();
      edited = {};
      paintLists();
      return;
    }
    if (e.target.closest(".reg-fields")) {
      saveFields();
      edited = {};
      paintLists();
    }
  }

  function paintLists() {
    var k = readKeys();
    document.getElementById("reg-safe").innerHTML = APIS.filter(inModule).map(function (item) {
      return row(item, k);
    }).join("");
    document.getElementById("reg-blocked").innerHTML = blockedTable();
    document.getElementById("reg-score").innerHTML = scoreTable();
    var boardEl = root.querySelector(".reg-board");
    if (boardEl) boardEl.outerHTML = board();
    markRun(k.base);
  }

  function scoreTable() {
    var rows = APIS.filter(inModule).map(function (item) {
      var state = results[item.id];
      var mark = state ? (state.ok ? "works" : "failed") : "";
      var label = state ? (state.ok ? "Works" : "Failed") : "Not run";
      var when = state && state.at ? stamp(state.at) : "—";
      return '<tr data-open="' + item.id + '"' + (openId === item.id ? ' class="on"' : "") + ">" +
        "<td>" + escapeText(item.name) + "</td>" +
        '<td><span class="reg-pill ' + mark + '">' + label + "</span></td>" +
        '<td class="reg-when">' + when + "</td></tr>";
    }).join("");
    return '<table class="reg-table"><thead><tr><th>API</th><th>Status</th><th>Last run</th></tr></thead><tbody>' +
      rows + "</tbody></table>";
  }

  function blockedTable() {
    var rows = BLOCKED.filter(function (item) {
      return item.module === moduleId;
    }).map(function (item) {
      return "<tr><td class=\"mono\">" + escapeText(item.path) + "</td><td>" + escapeText(item.why) +
        '</td><td><span class="reg-hold">Writes</span></td></tr>';
    }).join("");
    return '<table class="reg-table reg-writes"><thead><tr><th>Path</th><th>Why it stays off</th><th></th></tr></thead><tbody>' +
      rows + "</tbody></table>";
  }

  function row(item, k) {
    var open = openId === item.id;
    return '<article class="reg-row' + (open ? " open" : "") + '" data-card="' + item.id + '">' +
      '<input type="checkbox" data-check="' + item.id + '"' + (item.checked ? " checked" : "") + ' aria-label="Include ' + escapeAttr(item.name) + '">' +
      '<div><h3><button type="button" class="reg-name" data-open="' + item.id + '">' + escapeText(item.name) + "</button></h3>" +
      '<p class="reg-path"><span class="reg-method">' + item.method + '</span><span class="mono">' + escapeText(pathOf(item, k)) + "</span></p>" +
      "<p>" + escapeText(item.why) + "</p>" +
      '<pre class="sql reg-curl" data-curl-view="' + item.id + '">' + escapeText(curlOf(item, k)) + "</pre></div></article>" +
      (open ? detail(item, k) : "");
  }

  function detail(item, k) {
    var body = edited[item.id] != null ? edited[item.id] : pretty(item.body(k));
    var state = results[item.id];
    var response = state ? state.summary + (state.response ? "\n" + state.response : "") : "";
    return '<div class="reg-detail">' +
      '<textarea data-body="' + item.id + '" spellcheck="false">' + escapeText(body) + "</textarea>" +
      '<div class="reg-actions">' +
      '<button type="button" data-one="' + item.id + '">Run request</button>' +
      '<button type="button" data-curl="' + item.id + '">Copy curl</button>' +
      '<button type="button" data-reset="' + item.id + '">Reset request</button>' +
      "</div>" +
      '<pre class="sql">' + escapeText(response || "No response yet.") + "</pre>" +
      '<textarea data-paste="' + item.id + '" spellcheck="false" placeholder="Paste a response from another tool"></textarea>' +
      '<button type="button" data-judge="' + item.id + '">Judge pasted response</button>' +
      "</div>";
  }

  function runChecked() {
    var queue = APIS.filter(function (item) {
      return inModule(item) && item.safe && item.checked;
    });
    var i = 0;
    function next() {
      if (i >= queue.length) return;
      runOne(queue[i], function () {
        i += 1;
        next();
      });
    }
    next();
  }

  function runOne(item, done) {
    if (!item || !item.safe) {
      if (done) done();
      return;
    }
    saveFields();
    var k = readKeys();
    var missing = missingKeys(item, k);
    if (!k.base) missing = ["base URL"].concat(missing);
    var bodyText = edited[item.id] != null ? edited[item.id] : pretty(item.body(k));
    if (missing.length) {
      store(item, false, "Needs " + missing.join(", ") + ".", "", { url: "", request: bodyText });
      if (done) done();
      return;
    }
    var parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch (e) {
      store(item, false, "Request is not JSON.", "", { url: "", request: bodyText });
      if (done) done();
      return;
    }
    var url = joinUrl(k.base, pathOf(item, k));
    var sent = { url: url, request: bodyText };
    fetch("http://127.0.0.1:8770/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ url: url, method: item.method, body: parsed })
    }).then(function (res) {
      return res.text().then(function (text) {
        return { status: res.status, text: text };
      });
    }).then(function (got) {
      var wrapped = null;
      try { wrapped = JSON.parse(got.text); } catch (e) { wrapped = null; }
      if (wrapped && wrapped.error) {
        store(item, false, wrapped.error, url, sent);
      } else if (!wrapped || wrapped.status == null) {
        store(item, false, "The local runner did not return a response.", got.text, sent);
      } else {
        var judged = judge(wrapped.status, wrapped.body || "");
        store(item, judged.ok, judged.summary, wrapped.body || "", sent);
      }
      if (done) done();
    }).catch(function () {
      store(item, false, "The browser cannot call that host. Postman can. In this folder run node regression-proxy.js, then run the request again.", url, sent);
      if (done) done();
    });
  }

  function judgePasted(item) {
    var box = root.querySelector('[data-paste="' + item.id + '"]');
    var text = box ? box.value.trim() : "";
    if (!text) return;
    var judged = judge(200, text);
    store(item, judged.ok, judged.summary, text);
  }

  function judge(status, text) {
    var json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    if (status < 200 || status >= 300) return { ok: false, summary: "HTTP " + status };
    if (!json || typeof json !== "object") return { ok: false, summary: "Response is not JSON" };
    if (json.resultCode && String(json.resultCode) !== "0000") {
      return { ok: false, summary: json.resultMsg || ("result " + json.resultCode) };
    }
    if (typeof json.code === "number" && json.code !== 0) {
      return { ok: false, summary: json.msg || ("code " + json.code) };
    }
    var extra = "";
    if (json.outResult != null) extra = " outResult " + json.outResult;
    return { ok: true, summary: "Responded" + extra };
  }

  function store(item, ok, summary, response, sent) {
    results[item.id] = { ok: ok, summary: summary, response: clip(response, 12000), at: Date.now() };
    saveResults();
    if (sent) remember(item, sent, ok, summary);
    openId = item.id;
    paintLists();
    revealOpen();
    if (!document.getElementById("view-log").classList.contains("hidden")) renderLog();
  }

  function remember(item, sent, ok, summary) {
    logs.unshift({
      at: Date.now(),
      module: item.module,
      name: item.name,
      method: item.method,
      url: sent.url || "",
      request: clip(sent.request || "", 4000),
      ok: ok,
      summary: summary
    });
    if (logs.length > 100) logs.length = 100;
    localStorage.setItem(LOG_KEY, JSON.stringify(logs));
  }

  function renderLog() {
    var logRoot = document.getElementById("view-log");
    var rows = logs.map(function (entry, index) {
      var mark = entry.ok ? "works" : "failed";
      var label = entry.ok ? "Works" : "Failed";
      var open = openLog === index;
      return '<tr data-log="' + index + '"' + (open ? ' class="on"' : "") + ">" +
        '<td class="reg-when">' + stamp(entry.at) + "</td>" +
        "<td>" + escapeText(moduleName(entry.module)) + "</td>" +
        "<td>" + escapeText(entry.name) + "</td>" +
        '<td><span class="reg-pill ' + mark + '">' + label + "</span></td>" +
        '<td class="mono">' + escapeText(entry.url || "Not sent") + "</td></tr>" +
        (open ? '<tr class="log-detail"><td colspan="5"><p>' + escapeText(entry.summary) + "</p>" +
          '<pre class="sql">' + escapeText(entry.request || "No request body.") + "</pre></td></tr>" : "");
    }).join("");
    logRoot.innerHTML =
      '<p class="reg-lead">Calls sent from FCS Generic, PayHA, Kiosk, and Frontend. Newest first. A long response, such as a receipt PDF, is kept on the request row and shortened here.</p>' +
      '<div class="reg-actions"><button type="button" id="log-clear">Clear log</button></div>' +
      (logs.length ? '<table class="reg-table log-table"><thead><tr><th>Time</th><th>Module</th><th>API</th><th>Status</th><th>Address</th></tr></thead><tbody>' +
        rows + "</tbody></table>" : '<p class="reg-note">No calls yet.</p>');
  }

  function clip(text, max) {
    var value = String(text || "");
    if (value.length <= max) return value;
    return value.slice(0, max) + "\n… truncated.";
  }

  function moduleName(id) {
    return { generic: "FCS Generic", payha: "PayHA", kiosk: "Kiosk", frontend: "Frontend" }[id] || id;
  }

  function loadLogs() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); }
    catch (e) { return []; }
  }

  function revealOpen() {
    if (!openId) return;
    var card = root.querySelector('[data-card="' + openId + '"]');
    if (card) card.scrollIntoView({ block: "nearest" });
  }

  function copyCurl(item) {
    var text = curlOf(item, readKeys());
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
  }

  function curlOf(item, k) {
    var bodyText = edited[item.id] != null ? edited[item.id] : pretty(item.body(k));
    var compact;
    try { compact = JSON.stringify(JSON.parse(bodyText)); }
    catch (e) { compact = bodyText; }
    return "curl --location '" + joinUrl(k.base || "", pathOf(item, k)) + "' \\\n" +
      "--header 'Content-Type: application/json' \\\n" +
      "--header 'Accept: application/json' \\\n" +
      "--data '" + String(compact).replace(/'/g, "'\\''") + "'";
  }

  function markRun(base) {
    var prod = isProd(base);
    var run = document.getElementById("reg-run");
    if (run) run.classList.toggle("danger", prod);
    root.querySelectorAll("[data-one]").forEach(function (btn) {
      btn.classList.toggle("danger", prod);
    });
  }

  function isProd(url) {
    return /fcs-corp-prd|fcs-corp-hapay-prd|eapsrv76a|prdcld1|:3249[567]|:3449[567]/i.test(url || "");
  }

  function board() {
    var rows = APIS.filter(inModule);
    var works = 0;
    var failed = 0;
    rows.forEach(function (item) {
      var state = results[item.id];
      if (!state) return;
      if (state.ok) works += 1;
      else failed += 1;
    });
    var idle = rows.length - works - failed;
    return '<div class="reg-board"><b class="works">' + works + ' works</b><b class="failed">' + failed +
      ' failed</b><b>' + idle + " not run</b></div>";
  }

  function inModule(item) { return item.module === moduleId; }

  function findApi(id) {
    for (var i = 0; i < APIS.length; i++) if (APIS[i].id === id) return APIS[i];
    return null;
  }

  function pathOf(item, k) {
    return item.path.replace("{hospital}", encodeURIComponent(k.hospital || ""));
  }

  function missingKeys(item, k) {
    var names = { hospital: "hospital", moe: "MOE order", moeNum: "a numeric MOE order", caseNo: "case no.", pi: "PI key", sfi: "SFI no." };
    return item.needs.filter(function (key) { return !k[key]; }).map(function (key) { return names[key] || key; });
  }

  function readKeys() {
    var fx = readFixture(shownGroup || currentGroup(baseValue()));
    var moe = value("reg-moe", fx.moe).split(",")[0].trim();
    return {
      base: baseValue().replace(/\/+$/, ""),
      hospital: value("reg-hospital", fx.hospital).trim(),
      caseNo: value("reg-case", fx.case).trim(),
      moe: moe,
      moeNum: /^\d+$/.test(moe) ? Number(moe) : 0,
      pi: value("reg-pi", fx.pi).trim(),
      sfi: value("reg-sfi", fx.sfi).trim()
    };
  }

  function currentGroup(base) {
    var list = ENVS[moduleId] || [];
    var label = "Custom";
    var url = String(base || "").replace(/\/+$/, "");
    for (var i = 0; i < list.length; i++) {
      if (list[i][1] === url) label = list[i][0];
    }
    if (label === "PRD" || label === "PRD DNS" || label === "PRD list") return "PRD";
    if (label === "Custom") return "custom:" + moduleId;
    return label;
  }

  function readFixture(group) {
    var names = ["hospital", "case", "moe", "pi", "sfi"];
    var out = {};
    var moved = localStorage.getItem("fcs-system:reg:legacy-moved");
    names.forEach(function (name) {
      var saved = localStorage.getItem(fixtureKey(group, name));
      if (saved == null && !moved) saved = localStorage.getItem("fcs-system:reg:" + name) || "";
      out[name] = saved || "";
    });
    if (!moved) {
      names.forEach(function (name) {
        localStorage.setItem(fixtureKey(group, name), out[name]);
      });
      localStorage.setItem("fcs-system:reg:legacy-moved", group);
    }
    return out;
  }

  function loadFixture(group) {
    var fx = readFixture(group);
    setVal("reg-hospital", fx.hospital);
    setVal("reg-case", fx.case);
    setVal("reg-moe", fx.moe);
    setVal("reg-pi", fx.pi);
    setVal("reg-sfi", fx.sfi);
  }

  function saveFixture(group) {
    if (!group) return;
    [["reg-hospital", "hospital"], ["reg-case", "case"], ["reg-moe", "moe"], ["reg-pi", "pi"], ["reg-sfi", "sfi"]].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el) localStorage.setItem(fixtureKey(group, pair[1]), el.value);
    });
  }

  function fixtureKey(group, name) {
    return "fcs-system:reg:env:" + group + ":" + name;
  }

  function syncEnvSelect() {
    var sel = document.getElementById("reg-env");
    var url = baseValue().replace(/\/+$/, "");
    if (!sel) return;
    sel.value = "";
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === url) sel.selectedIndex = i;
    }
  }

  function baseValue() {
    var el = document.getElementById("reg-base");
    if (el && el.getAttribute("data-mod") === moduleId) return el.value;
    return localStorage.getItem("fcs-system:reg:" + moduleId) || defaultBase(moduleId);
  }

  function defaultBase(id) {
    var list = ENVS[id] || [];
    for (var i = 0; i < list.length; i++) if (list[i][0] === "PRD DNS") return list[i][1];
    return list.length ? list[0][1] : "";
  }

  function envField(base) {
    var list = ENVS[moduleId] || [];
    var known = false;
    var html = '<label>Environment<select id="reg-env">';
    for (var i = 0; i < list.length; i++) {
      var on = list[i][1] === base;
      if (on) known = true;
      html += '<option value="' + escapeAttr(list[i][1]) + '"' + (on ? " selected" : "") +
        ' title="' + escapeAttr(list[i][2]) + '">' + list[i][0] + "</option>";
    }
    html += '<option value=""' + (known || !base ? "" : " selected") + ">Custom</option></select></label>";
    return html;
  }

  function stamp(at) {
    var d = new Date(at);
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
      pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function value(id, fallback) {
    var el = document.getElementById(id);
    if (el) return el.value;
    return fallback || "";
  }

  function saveFields() {
    var base = document.getElementById("reg-base");
    if (base) localStorage.setItem("fcs-system:reg:" + moduleId, base.value);
    saveFixture(shownGroup);
  }

  function loadResults() {
    try { return JSON.parse(localStorage.getItem("fcs-system:reg:results") || "{}"); }
    catch (e) { return {}; }
  }

  function saveResults() {
    localStorage.setItem("fcs-system:reg:results", JSON.stringify(results));
  }

  function field(id, label, val, kind, placeholder) {
    var mod = id === "reg-base" ? ' data-mod="' + moduleId + '"' : "";
    var wide = kind.indexOf("wide") >= 0 ? ' class="wide"' : "";
    return "<label" + wide + ">" + label + '<input id="' + id + '" class="' + kind + '" value="' + escapeAttr(val) +
      '" placeholder="' + escapeAttr(placeholder) + '" spellcheck="false"' + mod + "></label>";
  }

  function setVal(id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val;
  }

  function joinUrl(base, path) {
    if (!base) return path;
    return base + path;
  }

  function pretty(value) {
    return JSON.stringify(value, null, 2);
  }

  function escapeText(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escapeAttr(text) {
    return escapeText(text).replace(/"/g, "&quot;");
  }

  function api(module, id, name, method, path, safe, checked, why, body, needs) {
    return { module: module, id: id, name: name, method: method, path: path, safe: safe, checked: checked, why: why, body: body, needs: needs };
  }

  function block(module, path, why) {
    return { module: module, path: path, why: why };
  }
})();
