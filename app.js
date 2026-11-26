(function () {
  const STAGES = [
    { id: "profile", title: "1 · MOE profile" },
    { id: "trigger", title: "2 · Insert trigger" },
    { id: "log", title: "3 · Log and exception" },
    { id: "fcs", title: "4 · FCS rows" },
    { id: "after", title: "5 · PayHA and receipt" },
    { id: "check", title: "6 · Checks" }
  ];

  const NODES = [
    {
      id: "src-hdr",
      stage: "profile",
      tone: "read",
      kicker: "Source",
      title: "MED_PROFILE_CHARGE_HDR",
      key: "MOE order",
      needs: ["moe"],
      trail: ["src-hdr"],
      summary: "MOE replication inserts the charge header here. The header trigger fires on that insert. Look up by MOE order.",
      sql: [{ title: "MED_PROFILE_CHARGE_HDR", build: sqlHdr }]
    },
    {
      id: "src-dtl",
      stage: "profile",
      tone: "read",
      kicker: "Source",
      title: "MED_PROFILE_CHARGE_DETAIL",
      key: "MOE order",
      needs: ["moe"],
      trail: ["src-hdr", "src-dtl"],
      summary: "MOE replication inserts the charge lines here. The detail trigger fires on that insert and does the SDC charging work. Look up by MOE order.",
      sql: [{ title: "MED_PROFILE_CHARGE_DETAIL", build: sqlDtl }]
    },
    {
      id: "trg-hdr",
      stage: "trigger",
      tone: "trigger",
      kicker: "Trigger",
      title: "fcs_tr_i_fc_med_hdr",
      key: "No SQL of its own",
      needs: [],
      trail: ["src-hdr", "trg-hdr"],
      summary: "Header insert trigger. It sets sysmon_moe_rep.last_upd_dtm from the header create time and sysmon_moe_rep.moe_order_no from the MOE order, then inserts med_profile_charge_hdr_log. This page has no lookup for sysmon_moe_rep.",
      jumps: [
        ["src-hdr", "Header rows"],
        ["log-hdr", "Header log"]
      ]
    },
    {
      id: "trg-dtl",
      stage: "trigger",
      tone: "trigger",
      kicker: "Trigger",
      title: "fcs_tr_i_fc_med_detail",
      key: "No SQL of its own",
      needs: [],
      trail: ["src-dtl", "trg-dtl"],
      summary: "Detail insert trigger. This is the SDC charging step. It reads the header, checks hospital rollout, and exits on a missing header, pay flag X, an inactive line, a non-MOE marker, or chargeable unit 9999. When there is no service context it inserts fc_case_services with service_cde SDC and an fc_opas_attn row. It then inserts fc_drug_charging and adds item_cnt and charge_amt on the case. A DF receipt already on the charge forces the rate to zero. On success, an eligible row (positive charge, valid pay code, not PA/TPA or an eligibility pay code) is inserted into fc_sdc_txn_index with process_ind N and payha_flg N. Failures go to fc_med_detail_exception.",
      jumps: [
        ["src-dtl", "Detail rows"],
        ["exc", "Exception"],
        ["case", "Case service"],
        ["charge", "Drug charging"],
        ["attn", "Attendance"],
        ["txn", "SDC queue"]
      ]
    },
    {
      id: "log-hdr",
      stage: "log",
      tone: "write",
      kicker: "Written by header trigger",
      title: "MED_PROFILE_CHARGE_HDR_LOG",
      key: "MOE order",
      needs: ["moe"],
      trail: ["src-hdr", "trg-hdr", "log-hdr"],
      summary: "Audit snapshot of the charge header. The header trigger inserts it. Look up by MOE order, ordered by log time.",
      sql: [{ title: "MED_PROFILE_CHARGE_HDR_LOG", build: sqlHdrLog }]
    },
    {
      id: "log-dtl",
      stage: "log",
      tone: "read",
      kicker: "Lookup",
      title: "MED_PROFILE_CHARGE_DETAIL_LOG",
      key: "MOE order",
      needs: ["moe"],
      trail: ["src-dtl", "log-dtl"],
      summary: "Detail log for this MOE order. Use it next to the detail rows when you need the logged copy.",
      sql: [{ title: "MED_PROFILE_CHARGE_DETAIL_LOG", build: sqlDtlLog }]
    },
    {
      id: "exc",
      stage: "log",
      tone: "warn",
      kicker: "Exception path",
      title: "FC_MED_DETAIL_EXCEPTION",
      key: "MOE order",
      needs: ["moe"],
      trail: ["src-dtl", "trg-dtl", "exc"],
      summary: "The detail trigger writes here and stops when the hospital is outside rollout, the header is missing, or the line is skipped. Look up by MOE order. An empty result means this order did not take the exception path.",
      sql: [{ title: "FC_MED_DETAIL_EXCEPTION", build: sqlExc }]
    },
    {
      id: "case",
      stage: "fcs",
      tone: "write",
      kicker: "Written by detail trigger",
      title: "FC_CASE_SERVICES",
      key: "Hospital + case",
      needs: ["hospital", "case"],
      trail: ["src-dtl", "trg-dtl", "case"],
      summary: "Service header for the charge. The detail trigger inserts service_cde SDC when it cannot find an existing context, then updates item_cnt and charge_amt as lines are added. This lookup is by hospital and case, not by MOE order. The order link is the check that joins this table to fc_drug_charging.",
      sql: [{ title: "FC_CASE_SERVICES", build: sqlCase }]
    },
    {
      id: "charge",
      stage: "fcs",
      tone: "write",
      kicker: "Written by detail trigger",
      title: "FC_DRUG_CHARGING",
      key: "Hospital + MOE order",
      needs: ["hospital", "moeNum"],
      trail: ["src-dtl", "trg-dtl", "charge"],
      summary: "One row per charged MOE line. The detail trigger inserts it with status IS or CC. Look up by hospital and numeric MOE order.",
      sql: [{ title: "FC_DRUG_CHARGING", build: sqlCharge }]
    },
    {
      id: "charge-log",
      stage: "fcs",
      tone: "read",
      kicker: "Lookup",
      title: "FC_DRUG_CHARGING_LOG",
      key: "Hospital + case + MOE order",
      needs: ["hospital", "case", "moeNum"],
      trail: ["charge", "charge-log"],
      summary: "Log of the charging row. This lookup needs the hospital, the case, and the numeric MOE order together.",
      sql: [{ title: "FC_DRUG_CHARGING_LOG", build: sqlChargeLog }]
    },
    {
      id: "attn",
      stage: "fcs",
      tone: "write",
      kicker: "Written on a new service",
      title: "FC_OPAS_ATTN",
      key: "Hospital + MOE order",
      needs: ["hospital", "moeNum"],
      trail: ["src-dtl", "trg-dtl", "attn"],
      summary: "Attendance for the service. The detail trigger inserts it when it creates a new case-service context, including the refill path that copies the original attendance. The direct table lookup used here joins attendance to drug charging on hospital, case, and service time, then filters the MOE order.",
      sql: [{ title: "FC_OPAS_ATTN join FC_DRUG_CHARGING", build: sqlAttn }]
    },
    {
      id: "txn",
      stage: "after",
      tone: "queue",
      kicker: "Queue",
      title: "FC_SDC_TXN_INDEX",
      key: "Hospital + case",
      needs: ["hospital", "case"],
      trail: ["trg-dtl", "txn"],
      summary: "Handoff to PayHA. The detail trigger inserts process_ind N and payha_flg N when the charge is eligible. /fcsPUPayhaCreateSdc consumes that row. This lookup is by hospital and case, ordered by service time.",
      sql: [{ title: "FC_SDC_TXN_INDEX", build: sqlTxn }]
    },
    {
      id: "payha",
      stage: "after",
      tone: "write",
      kicker: "PayHA list",
      title: "FC_PAYHA_DRUG_CHARGING",
      key: "Hospital + MOE order",
      needs: ["hospital", "moeNum"],
      trail: ["txn", "payha"],
      summary: "PayHA charging row for the MOE order. The SDC queue consumer maintains it after /fcsPUPayhaCreateSdc runs.",
      sql: [{ title: "FC_PAYHA_DRUG_CHARGING", build: sqlPayha }]
    },
    {
      id: "rcpt",
      stage: "after",
      tone: "later",
      kicker: "Later lookup",
      title: "FC_RECEIPTS",
      key: "Hospital + MOE order",
      needs: ["hospital", "moeNum"],
      trail: ["charge", "rcpt"],
      summary: "Receipts are not inserted by the SDC trigger. The trigger only reads them: a DF receipt on the charge forces the rate to zero. This lookup finds receipts that share hospital, case, and service time with the drug charging row.",
      sql: [{ title: "FC_RECEIPTS join FC_DRUG_CHARGING", build: sqlRcpt }]
    },
    {
      id: "chk-case",
      stage: "check",
      tone: "check",
      kicker: "Check",
      title: "Case joined to charging",
      key: "Hospital + MOE order",
      needs: ["hospital", "moeNum"],
      trail: ["case", "charge", "chk-case"],
      summary: "The usual MOE check. fc_case_services joined to fc_drug_charging on hospital, case, and service time. Shows pay code, pi_key, item count, charge, receipt amount, and outstanding amount for the MOE order.",
      sql: [{ title: "Case service join drug charging", build: sqlChkCase }]
    },
    {
      id: "chk-attn",
      stage: "check",
      tone: "check",
      kicker: "Check",
      title: "Attendance joined to charging",
      key: "Hospital + MOE order",
      needs: ["hospital", "moeNum"],
      trail: ["attn", "charge", "chk-attn"],
      summary: "Attendance against the charging row: appointment sequence, pay code, OPAS pay flag, specialty, and NBI sequence for the MOE order.",
      sql: [{ title: "Attendance join drug charging", build: sqlChkAttn }]
    },
    {
      id: "chk-rcpt",
      stage: "check",
      tone: "check",
      kicker: "Check",
      title: "Receipt joined to charging",
      key: "Hospital + MOE order",
      needs: ["hospital", "moeNum"],
      trail: ["rcpt", "charge", "chk-rcpt"],
      summary: "Receipt type, payment means, amount, status, and debit/credit for receipts on the same service as this MOE order.",
      sql: [{ title: "Receipt join drug charging", build: sqlChkRcpt }]
    }
  ];

  const SIDE = [
    {
      id: "intf",
      stage: "side",
      tone: "read",
      kicker: "Interface",
      title: "FC_OPAS_ATTN_INTF",
      key: "Interface date",
      needs: ["since"],
      trail: ["intf"],
      summary: "OPAS attendance interface rows after the date you set. This query is not limited to the hospital, case, or MOE order in the header.",
      sql: [{ title: "FC_OPAS_ATTN_INTF", build: sqlIntf }]
    },
    {
      id: "intf-ctl",
      stage: "side",
      tone: "read",
      kicker: "Interface",
      title: "FC_OPAS_ATTN_INTF_CONTROL",
      key: "No filter",
      needs: [],
      trail: ["intf-ctl"],
      summary: "Latest OPAS interface control rows, newest process time first. There is no hospital or MOE filter on this statement.",
      sql: [{ title: "FC_OPAS_ATTN_INTF_CONTROL", build: sqlIntfCtl }]
    }
  ];

  const WALK = ["src-hdr", "src-dtl", "trg-hdr", "trg-dtl", "log-hdr", "log-dtl", "exc", "case", "charge", "charge-log", "attn", "txn", "payha", "rcpt", "chk-case", "chk-attn", "chk-rcpt"];
  const STEP = WALK.concat(["intf", "intf-ctl"]);
  const ALL = NODES.concat(SIDE);
  const BY_ID = Object.fromEntries(ALL.map(function (n) { return [n.id, n]; }));

  const NEED_LABEL = {
    hospital: "hospital",
    case: "case number",
    moe: "MOE order",
    moeNum: "numeric MOE order",
    since: "interface date"
  };

  let selected = localStorage.getItem("fcs-system:node") || "src-hdr";
  if (!BY_ID[selected]) selected = "src-hdr";

  const els = {
    hospital: document.getElementById("hospital"),
    caseNo: document.getElementById("case-no"),
    moe: document.getElementById("moe"),
    since: document.getElementById("since"),
    msg: document.getElementById("input-msg"),
    flow: document.getElementById("flow"),
    sideFlow: document.getElementById("side-flow"),
    detail: document.getElementById("detail"),
    theme: document.getElementById("theme")
  };

  els.hospital.value = localStorage.getItem("fcs-system:hospital") || "VH";
  els.caseNo.value = localStorage.getItem("fcs-system:case") || "";
  els.moe.value = localStorage.getItem("fcs-system:moe") || "";
  els.since.value = storedIso(localStorage.getItem("fcs-system:since") || "");
  if (localStorage.getItem("fcs-system:theme") === "light") document.documentElement.classList.add("light");
  syncThemeLabel();

  renderFlow();
  renderDetail();
  reveal(document.querySelector('.node[data-id="' + selected + '"]'));

  document.getElementById("inputs").addEventListener("submit", function (e) { e.preventDefault(); });
  document.getElementById("inputs").addEventListener("input", onInput);
  document.getElementById("example").addEventListener("click", fillExample);
  document.getElementById("clear-keys").addEventListener("click", clearKeys);
  document.getElementById("copy-all").addEventListener("click", copyAll);
  els.theme.addEventListener("click", toggleTheme);
  els.flow.addEventListener("click", onFlowClick);
  els.sideFlow.addEventListener("click", onFlowClick);
  els.detail.addEventListener("click", onDetailClick);
  document.addEventListener("keydown", onKey);

  function onInput() {
    persist();
    paintState();
    renderDetail();
  }

  function persist() {
    localStorage.setItem("fcs-system:hospital", els.hospital.value);
    localStorage.setItem("fcs-system:case", els.caseNo.value);
    localStorage.setItem("fcs-system:moe", els.moe.value);
    localStorage.setItem("fcs-system:since", els.since.value);
  }

  function fillExample() {
    els.hospital.value = "VH";
    els.caseNo.value = "SOPD2526037T";
    els.moe.value = "260012611";
    els.since.value = "2026-06-28";
    onInput();
  }

  function clearKeys() {
    els.caseNo.value = "";
    els.moe.value = "";
    els.since.value = "";
    onInput();
  }

  function toggleTheme() {
    document.documentElement.classList.toggle("light");
    localStorage.setItem("fcs-system:theme", document.documentElement.classList.contains("light") ? "light" : "dark");
    syncThemeLabel();
    if (window.fcsSyncProdCrTheme) window.fcsSyncProdCrTheme();
  }

  function syncThemeLabel() {
    els.theme.textContent = document.documentElement.classList.contains("light") ? "Dark mode" : "Light mode";
  }

  function onKey(e) {
    if (e.target.matches("input, textarea")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); walk(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); walk(-1); }
  }

  function walk(dir) {
    const i = STEP.indexOf(selected);
    const next = i < 0 ? STEP[0] : STEP[Math.max(0, Math.min(STEP.length - 1, i + dir))];
    choose(next);
  }

  function onFlowClick(e) {
    const btn = e.target.closest(".node");
    if (!btn) return;
    choose(btn.getAttribute("data-id"));
  }

  function onDetailClick(e) {
    const jump = e.target.closest("[data-jump]");
    if (jump) { choose(jump.getAttribute("data-jump")); return; }
    const copy = e.target.closest("[data-copy]");
    if (copy) copyBlock(copy.getAttribute("data-copy"), copy);
    const step = e.target.closest("[data-walk]");
    if (step) walk(Number(step.getAttribute("data-walk")));
  }

  function choose(id) {
    if (!BY_ID[id]) return;
    selected = id;
    localStorage.setItem("fcs-system:node", id);
    paintState();
    renderDetail();
    const el = document.querySelector('.node[data-id="' + id + '"]');
    if (el) el.focus({ preventScroll: true });
    reveal(el);
  }

  function reveal(el) {
    const scroller = document.getElementById("flow-scroll");
    if (!el || !scroller) return;
    const elRect = el.getBoundingClientRect();
    const scRect = scroller.getBoundingClientRect();
    if (elRect.left >= scRect.left + 8 && elRect.right <= scRect.right - 8) return;
    const delta = elRect.left - scRect.left - (scRect.width - elRect.width) / 2;
    scroller.scrollBy({ left: delta });
  }

  function renderFlow() {
    els.flow.innerHTML = STAGES.map(function (stage) {
      const cards = NODES.filter(function (n) { return n.stage === stage.id; }).map(nodeButton).join("");
      return '<section class="stage"><p class="stage-no">' + escapeHtml(stage.title) + "</p>" + cards + "</section>";
    }).join("");
    els.sideFlow.innerHTML = SIDE.map(nodeButton).join("");
    paintState();
  }

  function nodeButton(n) {
    return '<button type="button" class="node ' + n.tone + '" data-id="' + n.id + '">' +
      '<span class="kicker"><span>' + escapeHtml(n.kicker) + '</span><i class="dot"></i></span>' +
      "<strong>" + escapeHtml(n.title) + "</strong>" +
      '<span class="key">' + escapeHtml(n.key) + "</span></button>";
  }

  function paintState() {
    const ctx = readContext();
    els.msg.textContent = ctx.errors.join(" ");
    ALL.forEach(function (n) {
      const el = document.querySelector('.node[data-id="' + n.id + '"]');
      if (!el) return;
      const hot = selected === n.id || (BY_ID[selected].trail || []).indexOf(n.id) >= 0;
      el.classList.toggle("on", selected === n.id);
      el.classList.toggle("hot", hot && selected !== n.id);
      const dot = el.querySelector(".dot");
      const state = nodeState(n, ctx);
      dot.className = "dot " + state;
    });
  }

  function nodeState(n, ctx) {
    if (!n.sql) return "info";
    return missingNeeds(n, ctx).length ? "wait" : "ready";
  }

  function renderDetail() {
    const n = BY_ID[selected];
    const ctx = readContext();
    const missing = n.sql ? missingNeeds(n, ctx) : [];
    const trail = (n.trail || []).map(function (id) {
      const node = BY_ID[id];
      const cls = id === n.id ? " primary" : "";
      return '<button type="button" class="' + cls + '" data-jump="' + id + '">' + escapeHtml(node.title) + "</button>";
    }).join("");
    const walkBtns = '<div class="walk"><button type="button" data-walk="-1">Previous</button><button type="button" data-walk="1">Next</button></div>';
    let sqlHtml = "";
    if (n.sql) {
      sqlHtml = n.sql.map(function (block, i) {
        const built = block.build(ctx);
        const id = n.id + "-" + i;
        return sqlView(id, block.title, built, missing);
      }).join("");
    }
    const jumps = (n.jumps || []).map(function (j) {
      return '<button type="button" data-jump="' + j[0] + '">' + escapeHtml(j[1]) + "</button>";
    }).join("");
    els.detail.innerHTML =
      '<p class="role">' + escapeHtml(n.kicker) + "</p>" +
      "<h2>" + escapeHtml(n.title) + "</h2>" +
      walkBtns +
      '<p class="summary">' + escapeHtml(n.summary) + "</p>" +
      '<div class="trail">' + trail + "</div>" +
      (jumps ? '<div class="jumps">' + jumps + "</div>" : "") +
      sqlHtml +
      '<p class="copy-state" id="copy-state"></p>';
  }

  function explainGap(built, missing) {
    if (built.sql) return "";
    if (built.error && /digits only|letters and digits/.test(built.error)) return built.error;
    if (missing.length) return "Needs " + missing.map(function (k) { return NEED_LABEL[k]; }).join(", ") + ".";
    return built.error || "";
  }

  function sqlView(id, title, built, missing) {
    const reason = explainGap(built, missing);
    const body = built.sql || placeholderSql(reason);
    return '<section class="sql-block"><div class="sql-head"><h3>' + escapeHtml(title) + "</h3>" +
      '<button type="button" class="icon" data-copy="' + id + '" title="Copy" aria-label="Copy"' + (built.sql ? "" : " disabled") + ">" + copyIcon() + "</button></div>" +
      (reason && !built.sql ? '<p class="need">' + escapeHtml(reason) + "</p>" : "") +
      '<pre class="sql" data-sql-for="' + id + '">' + highlightSql(body) + "</pre></section>";
  }

  function placeholderSql(reason) {
    return "-- " + (reason || "Fill the header fields to build this SQL.");
  }

  function copyBlock(id, button) {
    const ctx = readContext();
    const n = BY_ID[selected];
    const index = Number(id.slice(n.id.length + 1));
    const built = n.sql[index].build(ctx);
    if (!built.sql) return;
    const text = "-- " + n.sql[index].title + "\n" + built.sql;
    writeClipboard(text, button);
  }

  function copyAll() {
    const ctx = readContext();
    const chunks = [];
    const skipped = [];
    WALK.forEach(function (id) {
      const n = BY_ID[id];
      if (!n.sql) return;
      n.sql.forEach(function (block) {
        const built = block.build(ctx);
        if (!built.sql) {
          const why = built.error || ("needs " + missingNeeds(n, ctx).map(function (k) { return NEED_LABEL[k]; }).join(", "));
          skipped.push(block.title + " (" + why + ")");
          return;
        }
        if (chunks.some(function (chunk) { return chunk.indexOf(built.sql) >= 0; })) return;
        chunks.push("-- " + block.title + "\n" + built.sql);
      });
    });
    const head = [
      "-- FCS tables data in SDC flow",
      "-- hospital=" + (ctx.hospital || ""),
      "-- case_no=" + (ctx.caseNo || ""),
      "-- moe_order=" + (ctx.orders.join(",") || "")
    ];
    if (skipped.length) head.push("-- skipped: " + skipped.join("; "));
    const text = head.join("\n") + "\n\n" + chunks.join("\n\n");
    writeClipboard(text, document.getElementById("copy-all"));
  }

  function writeClipboard(text, button) {
    const done = function () { flash(button); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(); }).catch(function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  function copyIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2"></path></svg>';
  }

  function flash(button) {
    const slot = document.getElementById("copy-state");
    if (slot) slot.textContent = "Copied";
    if (!button) return;
    button.classList.add("done");
    setTimeout(function () { button.classList.remove("done"); }, 1200);
  }

  function readContext() {
    const errors = [];
    const hospital = field(els.hospital.value, /^[A-Za-z0-9]{1,10}$/, "Hospital is 1–10 letters or digits.");
    const caseRaw = els.caseNo.value.trim();
    const caseNo = caseRaw ? field(caseRaw, /^[A-Za-z0-9 ]{1,40}$/, "Case number can use letters, digits, and spaces only.") : "";
    const sinceRaw = els.since.value.trim();
    const since = sinceRaw ? field(sinceRaw, /^\d{4}-\d{2}-\d{2}$/, "Choose an interface date.") : "";
    const parsed = parseOrders(els.moe.value);
    if (hospital.error) errors.push(hospital.error);
    if (caseNo && caseNo.error) errors.push(caseNo.error);
    if (since && since.error) errors.push(since.error);
    if (parsed.error) errors.push(parsed.error);
    const orders = parsed.tokens;
    const numeric = orders.length > 0 && orders.every(function (t) { return /^[0-9]+$/.test(t); });
    return {
      errors: errors,
      hospital: hospital.value || "",
      caseNo: caseNo && caseNo.value ? caseNo.value : "",
      since: since && since.value ? since.value : "",
      orders: orders,
      numeric: numeric,
      moeError: parsed.error || ""
    };
  }

  function storedIso(text) {
    var raw = String(text || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    var shown = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
    return shown ? shown[3] + "-" + shown[2] + "-" + shown[1] : "";
  }

  function field(raw, re, message) {
    const value = raw.trim();
    if (!value || !re.test(value)) return { value: "", error: message };
    return { value: value, error: "" };
  }

  function parseOrders(raw) {
    const tokens = raw.split(/[\s,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    const bad = tokens.filter(function (t) { return !/^[A-Za-z0-9]+$/.test(t); });
    if (bad.length) return { tokens: [], error: "MOE order can use letters and digits only." };
    return { tokens: tokens, error: "" };
  }

  function missingNeeds(n, ctx) {
    return (n.needs || []).filter(function (need) {
      if (need === "hospital") return !ctx.hospital;
      if (need === "case") return !ctx.caseNo;
      if (need === "since") return !ctx.since;
      if (need === "moe") return ctx.orders.length === 0 || !!ctx.moeError;
      if (need === "moeNum") return ctx.orders.length === 0 || !ctx.numeric;
      return false;
    });
  }

  function pred(tokens, quote) {
    if (tokens.length === 1) return quote ? "= '" + esc(tokens[0]) + "'" : "= " + tokens[0];
    const list = tokens.map(function (t) { return quote ? "'" + esc(t) + "'" : t; }).join(", ");
    return "IN (" + list + ")";
  }

  function moeNumProblem(ctx) {
    if (ctx.moeError) return ctx.moeError;
    if (!ctx.orders.length) return "Needs a numeric MOE order.";
    if (!ctx.numeric) return "This table stores the MOE order as a number. Use digits only.";
    return "";
  }

  function sqlHdr(ctx) {
    if (ctx.moeError || !ctx.orders.length) return { sql: "", error: ctx.moeError || "" };
    return { sql: "SELECT *\nFROM MED_PROFILE_CHARGE_HDR mpch\nWHERE mpch.MOE_ORD_NO " + pred(ctx.orders, true) + "\nORDER BY CREATE_DTM;" };
  }
  function sqlHdrLog(ctx) {
    if (ctx.moeError || !ctx.orders.length) return { sql: "", error: ctx.moeError || "" };
    return { sql: "SELECT *\nFROM MED_PROFILE_CHARGE_HDR_log mpch\nWHERE mpch.MOE_ORD_NO " + pred(ctx.orders, true) + "\nORDER BY log_dtm;" };
  }
  function sqlDtl(ctx) {
    if (ctx.moeError || !ctx.orders.length) return { sql: "", error: ctx.moeError || "" };
    return { sql: "SELECT *\nFROM MED_PROFILE_CHARGE_DETAIL mpcd\nWHERE mpcd.MOE_ORD_NO " + pred(ctx.orders, true) + "\nORDER BY CREATE_DTM;" };
  }
  function sqlDtlLog(ctx) {
    if (ctx.moeError || !ctx.orders.length) return { sql: "", error: ctx.moeError || "" };
    return { sql: "SELECT *\nFROM MED_PROFILE_CHARGE_DETAIL_log mpcd\nWHERE mpcd.MOE_ORD_NO " + pred(ctx.orders, true) + "\nORDER BY CREATE_DTM;" };
  }
  function sqlExc(ctx) {
    if (ctx.moeError || !ctx.orders.length) return { sql: "", error: ctx.moeError || "" };
    return { sql: "SELECT *\nFROM FC_MED_DETAIL_EXCEPTION fmde\nWHERE fmde.MOE_ORD_NO " + pred(ctx.orders, true) + ";" };
  }
  function sqlCase(ctx) {
    if (!ctx.hospital || !ctx.caseNo) return { sql: "", error: "" };
    return { sql: "SELECT *\nFROM FC_CASE_SERVICES a\nWHERE a.hospital_cde = '" + esc(ctx.hospital) + "'\nAND a.case_no = '" + esc(ctx.caseNo) + "'\nORDER BY a.service_dtm;" };
  }
  function sqlCharge(ctx) {
    const problem = moeNumProblem(ctx);
    if (problem || !ctx.hospital) return { sql: "", error: problem };
    return { sql: "SELECT *\nFROM fc_drug_charging\nWHERE hospital_cde = '" + esc(ctx.hospital) + "'\nAND MOE_ORDER_NO " + pred(ctx.orders, false) + "\nORDER BY fc_upd_dtm;" };
  }
  function sqlChargeLog(ctx) {
    const problem = moeNumProblem(ctx);
    if (problem || !ctx.hospital || !ctx.caseNo) return { sql: "", error: problem };
    return { sql: "SELECT *\nFROM fc_drug_charging_log\nWHERE hospital_cde = '" + esc(ctx.hospital) + "'\nAND MOE_ORDER_NO " + pred(ctx.orders, false) + "\nAND case_no = '" + esc(ctx.caseNo) + "'\nORDER BY fc_upd_dtm;" };
  }
  function sqlTxn(ctx) {
    if (!ctx.hospital || !ctx.caseNo) return { sql: "", error: "" };
    return { sql: "SELECT *\nFROM FC_SDC_TXN_INDEX a\nWHERE a.hospital_cde = '" + esc(ctx.hospital) + "'\nAND a.case_no = '" + esc(ctx.caseNo) + "'\nORDER BY a.service_dtm DESC;" };
  }
  function sqlPayha(ctx) {
    const problem = moeNumProblem(ctx);
    if (problem || !ctx.hospital) return { sql: "", error: problem };
    return { sql: "SELECT *\nFROM fc_payha_drug_charging\nWHERE hospital_cde = '" + esc(ctx.hospital) + "'\nAND moe_order_no " + pred(ctx.orders, false) + ";" };
  }
  function sqlAttn(ctx) { return sqlChkAttn(ctx); }
  function sqlChkAttn(ctx) {
    const problem = moeNumProblem(ctx);
    if (problem || !ctx.hospital) return { sql: "", error: problem };
    return { sql: "SELECT DISTINCT\n    a.case_no, b.MOE_ORDER_NO, a.service_dtm, a.appt_seq, a.pay_cde, a.payment_dtm, a.eis_service, a.eis_spec, a.eis_sub_spec, a.opas_spec, a.opas_unit, a.opas_pay_flag, a.NBI_SEQ_NUM\nFROM fc_opas_attn a\nJOIN fc_drug_charging b\n  ON a.hospital_cde = b.hospital_cde\n AND a.case_no = b.case_no\n AND a.service_dtm = b.service_dtm\nWHERE a.hospital_cde = '" + esc(ctx.hospital) + "'\nAND b.moe_order_no " + pred(ctx.orders, false) + "\nORDER BY a.service_dtm DESC;" };
  }
  function sqlChkCase(ctx) {
    const problem = moeNumProblem(ctx);
    if (problem || !ctx.hospital) return { sql: "", error: problem };
    return { sql: "SELECT DISTINCT b.moe_order_no, a.case_no, a.service_dtm, a.pi_key, a.service_cde, a.pay_cde, a.item_cnt, a.charge_amt, a.receipt_amt, a.status_cde, (a.charge_amt - a.receipt_amt) outstanding_amt\nFROM fc_case_services a, fc_drug_charging b\nWHERE a.hospital_cde = b.hospital_cde\nAND a.case_no = b.case_no\nAND a.service_dtm = b.service_dtm\nAND a.hospital_cde = '" + esc(ctx.hospital) + "'\nAND b.moe_order_no " + pred(ctx.orders, false) + "\nORDER BY a.service_dtm DESC;" };
  }
  function sqlRcpt(ctx) { return sqlChkRcpt(ctx); }
  function sqlChkRcpt(ctx) {
    const problem = moeNumProblem(ctx);
    if (problem || !ctx.hospital) return { sql: "", error: problem };
    return { sql: "SELECT DISTINCT\n    a.case_no, a.service_dtm, a.receipt_no, a.receipt_dtm, a.receipt_type, a.payment_means, a.receipt_amt, a.status_cde, a.cr_dr, a.no_charge_cde, a.fc_sys, a.FC_SHROFF, a.FC_USER, a.FC_WS\nFROM fc_receipts a\nJOIN fc_drug_charging b\n  ON a.hospital_cde = b.hospital_cde\n AND a.case_no = b.case_no\n AND a.service_dtm = b.service_dtm\nWHERE a.hospital_cde = '" + esc(ctx.hospital) + "'\nAND b.moe_order_no " + pred(ctx.orders, false) + "\nORDER BY a.receipt_dtm DESC;" };
  }
  function sqlIntf(ctx) {
    if (!ctx.since) return { sql: "", error: "" };
    return { sql: "SELECT *\nFROM fc_opas_attn_intf\nWHERE interface_dtm > TO_TIMESTAMP('" + esc(ctx.since) + "', 'YYYY-MM-DD')\nORDER BY interface_dtm DESC;" };
  }
  function sqlIntfCtl() {
    return { sql: "SELECT *\nFROM FC_OPAS_ATTN_INTF_CONTROL foaic\nORDER BY PROCESS_DTM DESC;" };
  }

  function esc(value) { return String(value).replace(/'/g, "''"); }

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlightSql(sql) {
    return String(sql).split("\n").map(function (line) {
      const escLine = escapeHtml(line);
      if (line.trim().indexOf("--") === 0) return '<span class="cm">' + escLine + "</span>";
      const parts = escLine.split(/('(?:''|[^'])*')/g);
      return parts.map(function (part, i) {
        if (i % 2 === 1) return '<span class="str">' + part + "</span>";
        return part.replace(/\b(SELECT|DISTINCT|FROM|WHERE|AND|OR|JOIN|ON|IN|ORDER|BY|DESC|ASC|AS|NOT|NULL|TO_TIMESTAMP)\b/g, '<span class="kw">$1</span>');
      }).join("");
    }).join("\n");
  }
})();
