(function () {
  var HOSP_KEY = "fcs-system:health:hospital";
  var SINCE_KEY = "fcs-system:health:since";
  var CONNECT_KEY = "fcs-system:health:connect";
  var USER_KEY = "fcs-system:health:user";
  var root = document.getElementById("view-health");
  var hospital = localStorage.getItem(HOSP_KEY) || "";
  var since = localStorage.getItem(SINCE_KEY) || "";
  var connect = localStorage.getItem(CONNECT_KEY) || "";
  var user = localStorage.getItem(USER_KEY) || "";
  var running = false;
  var stopCtrl = null;
  var stoppedByUser = false;
  var dashTab = "receipts";
  var dashPage = 0;

  render();
  root.addEventListener("input", onInput);
  root.addEventListener("click", onClick);

  function onInput(e) {
    var id = e.target.id;
    if (id === "health-hospital") hospital = e.target.value;
    if (id === "health-since") since = e.target.value;
    if (id === "health-connect") connect = e.target.value;
    if (id === "health-user") user = e.target.value;
    localStorage.setItem(HOSP_KEY, hospital);
    localStorage.setItem(SINCE_KEY, since);
    localStorage.setItem(CONNECT_KEY, connect);
    localStorage.setItem(USER_KEY, user);
  }

  function onClick(e) {
    var toggle = e.target.closest ? e.target.closest(".sql-toggle") : null;
    if (toggle) {
      var panel = toggle.closest("section");
      var block = panel ? panel.querySelector(".sql-block") : null;
      if (!block) return;
      block.hidden = !block.hidden;
      toggle.setAttribute("aria-expanded", block.hidden ? "false" : "true");
      return;
    }
    var range = e.target.getAttribute && e.target.getAttribute("data-range");
    if (range) {
      applyRange(range);
      dashPage = 0;
      run();
      return;
    }
    var tab = e.target.getAttribute && e.target.getAttribute("data-tab");
    if (tab) {
      dashTab = tab;
      dashPage = 0;
      run();
      return;
    }
    var page = e.target.getAttribute && e.target.getAttribute("data-page");
    if (page != null && page !== "") {
      dashPage = Math.max(0, parseInt(page, 10) || 0);
      run();
      return;
    }
    if (e.target.id === "health-stop") {
      stop();
      return;
    }
    if (e.target.id !== "health-run") return;
    dashPage = 0;
    run();
  }

  function applyRange(kind) {
    var day = new Date();
    if (kind === "yesterday") day.setDate(day.getDate() - 1);
    setClock("health-start", day, "00:00");
    setClock("health-end", day, "23:59");
  }

  function setClock(id, date, clock) {
    document.getElementById(id + "-date").value = datePart(date);
    document.getElementById(id + "-time").value = clock;
  }

  function datePart(date) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate());
  }

  function readStamp(id) {
    var day = document.getElementById(id + "-date").value;
    var clock = document.getElementById(id + "-time").value.trim();
    if (!day && !clock) return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
    return day + "T" + clock;
  }

  function render() {
    root.innerHTML =
      '<div class="health-page">' +
      '<div class="dash-top"><h1>FCS dashboard</h1><p class="src">Password is used for this check and is not stored. One database session is opened for the load and closed when the load finishes. Disconnect closes it sooner if a read is still running. Each read also stops after 8 seconds. A count runs only when an index can bound the time. Today is 00:00 through 23:59. The end minute is included.</p></div>' +
      '<div class="reg-fields">' +
      '<label class="wide">Connection string<input id="health-connect" class="url" spellcheck="false" placeholder="host:port/service" autocomplete="off" value="' + escapeAttr(connect) + '"></label>' +
      '<label>Username<input id="health-user" spellcheck="false" autocomplete="off" value="' + escapeAttr(user) + '"></label>' +
      '<label>Password<input id="health-pass" type="password" autocomplete="off"></label>' +
      '<label>Hospital<input id="health-hospital" class="short" maxlength="10" spellcheck="false" placeholder="All" value="' + escapeAttr(hospital) + '"></label>' +
      '<label>Start date<input id="health-start-date" type="date"></label>' +
      '<label>Start time<input id="health-start-time" class="clock" inputmode="numeric" maxlength="5" spellcheck="false" placeholder="HH:MM" autocomplete="off"></label>' +
      '<label>End date<input id="health-end-date" type="date"></label>' +
      '<label>End time<input id="health-end-time" class="clock" inputmode="numeric" maxlength="5" spellcheck="false" placeholder="HH:MM" autocomplete="off"></label>' +
      '<button type="button" data-range="yesterday">Yesterday</button>' +
      '<button type="button" data-range="today">Today</button>' +
      '<button type="button" id="health-run" class="primary">Connect and load</button>' +
      '<button type="button" id="health-stop" class="danger" disabled>Disconnect</button>' +
      '</div>' +
      '<p id="health-msg" class="need" role="status"></p>' +
      '<div id="health-out"></div>' +
      '</div>';
    document.getElementById("health-out").innerHTML = '<p class="muted">Enter the database login and press Connect and load. Today is 00:00 through 23:59. The end minute is included.</p>';
    applyRange("today");
  }

  function run() {
    if (running) return;
    connect = document.getElementById("health-connect").value;
    user = document.getElementById("health-user").value;
    hospital = document.getElementById("health-hospital").value;
    var start = readStamp("health-start");
    var end = readStamp("health-end");
    localStorage.setItem(HOSP_KEY, hospital);
    localStorage.setItem(CONNECT_KEY, connect);
    localStorage.setItem(USER_KEY, user);
    var pass = document.getElementById("health-pass").value;
    var problems = [];
    if (!connect.trim() || !user.trim() || !pass) problems.push("Connection string, username, and password are required.");
    if (hospital.trim() && !/^[A-Za-z0-9]{1,10}$/.test(hospital.trim())) problems.push("Hospital is 1–10 letters or digits.");
    if (start == null || end == null) problems.push("Choose a date. Time is 24-hour HH:MM, from 00:00 to 23:59.");
    else if ((start && !end) || (!start && end)) problems.push("Enter both a start and an end.");
    var msg = document.getElementById("health-msg");
    msg.textContent = problems.join(" ");
    if (problems.length) return;
    if (location.protocol === "file:") {
      msg.textContent = "Open http://127.0.0.1:8770/ after node regression-proxy.js. A file page cannot reach the database.";
      return;
    }
    running = true;
    stoppedByUser = false;
    document.getElementById("health-run").disabled = true;
    document.getElementById("health-stop").disabled = false;
    msg.textContent = "Reading. Disconnect closes the database session if this runs too long. A query also stops after 8 seconds.";
    stopCtrl = new AbortController();
    fetch("/health", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      signal: stopCtrl.signal,
      body: JSON.stringify({
        connectString: connect.trim(),
        user: user.trim(),
        password: pass,
        hospital: hospital.trim(),
        start: start,
        end: end,
        tab: dashTab,
        page: dashPage
      })
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (pack) {
      if (!pack.ok) throw new Error(pack.body && pack.body.error || "The check failed.");
      msg.textContent = pack.body.stopped ? (pack.body.warnings || []).join(" ") : "";
      paint(pack.body);
    }).catch(function (err) {
      if (stoppedByUser || (err && err.name === "AbortError")) {
        msg.textContent = "Disconnected. The database session was closed.";
      } else {
        msg.textContent = err && err.message ? err.message : "The runner did not answer. Start node regression-proxy.js and open http://127.0.0.1:8770/.";
      }
    }).then(function () {
      running = false;
      stopCtrl = null;
      var btn = document.getElementById("health-run");
      var stopBtn = document.getElementById("health-stop");
      if (btn) btn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
    });
  }

  function stop() {
    if (!running) return;
    stoppedByUser = true;
    var msg = document.getElementById("health-msg");
    if (msg) msg.textContent = "Disconnecting. The database session is being closed.";
    if (stopCtrl) stopCtrl.abort();
    fetch("/health/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: "{}"
    }).catch(function () { /* the load request closing also breaks the session */ });
  }

  function paint(data) {
    var cards = data.cards || {};
    var order = ["charge", "case", "sfi", "receipts"];
    var colors = { charge: "#d09a4a", case: "#d07070", sfi: "#b07cc4", receipts: "#3d9a6a" };
    var cardHtml = order.map(function (id) {
      var item = cards[id] || {};
      var sub = item.ran ? cardNote(id, item) : (item.reason || "Not counted");
      return '<article class="health-card"><div class="k">' + escapeText(item.title || id) + '</div><div class="v">' + escapeText(item.ran ? formatNum(item.count) : "—") + '</div><div class="s">' + escapeText(sub) + '</div></article>';
    }).join("");
    var buckets = {};
    (data.volume || []).forEach(function (series) {
      (series.rows || []).forEach(function (row) { buckets[row.bucket] = true; });
    });
    var labels = Object.keys(buckets).sort();
    var series = (data.volume || []).map(function (block) {
      var by = {};
      (block.rows || []).forEach(function (row) { by[row.bucket] = row.count; });
      return { name: block.title, color: colors[block.id] || "#2f6f9f", active: true, values: labels.map(function (label) { return by[label] || 0; }) };
    });
    var list = data.list || { columns: [], rows: [], page: 0, pageSize: 100, total: 0, tab: "receipts" };
    var tabs = order.map(function (id) {
      return '<button type="button" data-tab="' + id + '"' + (list.tab === id ? ' class="primary"' : "") + '>' + escapeText((cards[id] && cards[id].title) || id) + '</button>';
    }).join("");
    var shown = presentList(list);
    var from = list.total ? list.page * list.pageSize + 1 : 0;
    var to = Math.min(list.total || 0, (list.page + 1) * list.pageSize);
    var last = Math.max(0, Math.ceil((list.total || 0) / list.pageSize) - 1);
    if (last > 200) last = 200;
    document.getElementById("health-out").innerHTML =
      '<p class="src">' + escapeText((data.hospital || "All hospitals") + " · " + (data.start || "") + " to " + (data.end || "") + " · database " + (data.now || "")) + '</p>' +
      '<div class="health-cards dash-cards">' + cardHtml + '</div>' +
      receiptLatestPanel(data) +
      '<div class="dash-split">' +
      '<section class="health-panel"><h2>Volume by ' + escapeText(data.bucket || "hour") + '</h2>' +
      (series.length ? lineSvg(labels, series, { time: true, labelEvery: Math.max(1, Math.ceil(labels.length / 6)), yName: "Count", xName: "Time" }) : '<p class="muted">No indexed range was counted.</p>') +
      '</section>' +
      '<section class="health-panel"><div class="dash-tabs">' + tabs + '</div>' +
      (shown.head ? '<p class="src">' + escapeText(shown.note) + '</p><div class="dash-table-wrap"><table class="dash-table"><thead><tr>' + shown.head + '</tr></thead><tbody>' + shown.body + '</tbody></table></div>' : '<p class="muted">' + escapeText((cards[list.tab] && cards[list.tab].reason) || "No rows on this page.") + '</p>') +
      '<div class="dash-pager"><button type="button" data-page="0">First</button><button type="button" data-page="' + Math.max(0, list.page - 1) + '">Prev</button><button type="button" data-page="' + (list.page + 1) + '">Next</button><button type="button" data-page="' + last + '">Last</button><span>' + from + '–' + to + ' of ' + formatNum(list.total || 0) + '</span></div>' +
      '</section></div>' +
      '<section class="health-panel">' + panelHead("SQL") + sqlBlock((data.sql || []).join("\n\n")) + '</section>';
  }

  function moeMonitorPanel(data) {
    var rows = data.moe || [];
    var today = String(data.now || "").slice(0, 10);
    var showHeader = data.moeHeader !== false;
    var showDetail = !!data.moeDetail;
    var head = "<th>Hospital</th>" +
      (showHeader ? "<th>Header arrived</th><th>Header order</th>" : "") +
      (showDetail ? "<th>Detail create_dtm</th><th>Detail order</th>" : "") +
      "<th>Minutes</th>";
    var body = rows.map(function (row) {
      var when = row.headerAt || row.detailAt || "";
      var age = minutesSince(data.now, when);
      return "<tr><td>" + escapeText(row.hospital || "") + "</td>" +
        (showHeader ? markedTime(row.headerAt, today) + "<td>" + escapeText(row.headerOrder || "") + "</td>" : "") +
        (showDetail ? markedTime(row.detailAt, today) + "<td>" + escapeText(row.detailOrder || "") + "</td>" : "") +
        "<td>" + escapeText(age) + "</td></tr>";
    }).join("");
    var note = data.moeReason || "One latest row per hospital. Header time prefers log_dtm on med_profile_charge_hdr_log when that index starts with the hospital and then LOG_DTM. Otherwise it is create_dtm on the header. Detail create_dtm is included on the same rule. The oldest time is first. Green is the database’s current day. Grey is an earlier day.";
    return '<section class="health-panel"><h2>Latest MOE row by hospital</h2>' +
      '<p class="src">' + escapeText(note) + '</p>' +
      (body ? '<div class="dash-table-wrap"><table class="dash-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' : '') +
      '</section>';
  }

  function markedTime(when, today) {
    var mark = "";
    if (when && today && String(when).slice(0, 10) === today) mark = "mark-go";
    else if (when) mark = "mark-stop";
    return '<td class="' + mark + '">' + escapeText(when || "—") + "</td>";
  }

  function minutesSince(nowText, thenText) {
    var now = Date.parse(String(nowText || "").replace(" ", "T"));
    var then = Date.parse(String(thenText || "").replace(" ", "T"));
    if (!isFinite(now) || !isFinite(then)) return "";
    return String(Math.round((now - then) / 60000));
  }

  function latestCreatePanel(data) {
    var rows = data.latestCreate || [];
    if (!rows.length) return "";
    var today = String(data.now || "").slice(0, 10);
    var body = rows.map(function (row) {
      var when = row.ran ? (row.latest || "No rows") : "Not read";
      var note = row.ran ? row.scope : (row.reason || "");
      var mark = "";
      if (row.ran && row.latest && today && row.latest.slice(0, 10) === today) mark = " mark-go";
      else if (row.ran && row.latest) mark = " mark-stop";
      return "<tr><td>" + escapeText(row.table) + "</td><td class=\"" + mark.trim() + "\">" + escapeText(when) + "</td><td>" + escapeText(note) + "</td></tr>";
    }).join("");
    return '<section class="health-panel"><h2>Latest create time on the med profile tables</h2>' +
      '<p class="src">CMS copies create_dtm onto the header and the detail. This is the newest of those times, from MAX(create_dtm). It runs only when an index can answer the maximum. A row stored with an older create time does not move it. Green is the database’s current day. Grey is an earlier day.</p>' +
      '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Table</th><th>Latest create_dtm</th><th>Scope</th></tr></thead><tbody>' + body + "</tbody></table></div></section>";
  }

  function receiptLatestPanel(data) {
    var block = data.receiptLatest || { ran: false, reason: "", rows: [], sql: "" };
    var known = ["DR", "DD", "DF", "DV", "DH"];
    var byType = {};
    (block.rows || []).forEach(function (row) { byType[String(row.type || "").trim()] = row; });
    var rows = [];
    if (block.ran) {
      known.forEach(function (code) {
        rows.push(byType[code] || { type: code, count: 0 });
      });
      Object.keys(byType).sort().forEach(function (code) {
        if (known.indexOf(code) < 0) rows.push(byType[code]);
      });
    }
    var note = block.ran
      ? "DR, DD, DF, DV, and DH are always listed. A blank row had no issued debit in this range. A row with a time is the receipt with the latest receipt_dtm. Any other type appears only when it has a create."
      : (block.reason || "Receipts were not read.");
    var body = rows.map(function (row) {
      var found = !!row.at;
      var happened = found ? receiptEvent({ STATUS_CDE: row.status, CR_DR: row.side }) : "No create";
      return "<tr><td>" + escapeText(receiptType({ RECEIPT_TYPE: row.type })) + "</td>" +
        '<td class="' + (found ? "mark-go" : "mark-stop") + '">' + escapeText(found ? row.at : "—") + "</td>" +
        "<td>" + escapeText(found ? row.receiptNo : "") + "</td>" +
        "<td>" + escapeText(found ? row.hospital : "") + "</td>" +
        "<td>" + escapeText(found ? row.caseNo : "") + "</td>" +
        "<td>" + escapeText(found ? row.amount : "") + "</td>" +
        "<td>" + escapeText(found ? row.payment : "") + "</td>" +
        "<td>" + escapeText(found ? row.user : "") + "</td>" +
        "<td>" + escapeText(found ? row.ws : "") + "</td>" +
        "<td>" + escapeText(formatNum(row.count || 0)) + "</td>" +
        '<td class="' + (found ? tone(happened) : "mark-stop") + '">' + escapeText(happened) + "</td></tr>";
    }).join("");
    var table = body
      ? '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Type</th><th>Latest receipt time</th><th>Receipt</th><th>Hospital</th><th>Case</th><th>Amount</th><th>Payment</th><th>User</th><th>Workstation</th><th>Creates</th><th>What happened</th></tr></thead><tbody>' + body + "</tbody></table></div>"
      : "";
    return '<section class="health-panel">' + panelHead("Latest receipt of each type") +
      '<p class="src">' + escapeText(note) + "</p>" + table + sqlBlock(block.sql) + "</section>";
  }

  function cardNote(id, item) {
    if (id === "charge") return formatNum(item.extra || 0) + " MOE orders";
    if (id === "receipts") return formatNum(item.extra || 0) + " amount · creates and cancels";
    return "in this range";
  }

  function presentList(list) {
    var specs = LIST_SPEC[list.tab];
    if (!specs) {
      specs = (list.columns || []).map(function (key) {
        return { key: key, label: key.toLowerCase().replace(/_/g, " ") };
      });
    }
    if (!(list.rows || []).length || !specs.length) return { head: "", body: "", note: "" };
    return {
      note: LIST_NOTE[list.tab] || "",
      head: specs.map(function (spec) { return "<th>" + escapeText(spec.label) + "</th>"; }).join(""),
      body: list.rows.map(function (row) {
        return "<tr>" + specs.map(function (spec) {
          var text = spec.value ? spec.value(row) : row[spec.key];
          var shownText = text == null ? "" : text;
          var mark = spec.value ? tone(shownText) : "";
          return "<td" + (mark ? ' class="' + mark + '"' : "") + ">" + escapeText(shownText) + "</td>";
        }).join("") + "</tr>";
      }).join("")
    };
  }

  function receiptEvent(row) {
    var status = String(row.STATUS_CDE || "").trim();
    var side = String(row.CR_DR || "").trim();
    if (status === "IS" && side === "D") return "Create";
    if (status === "IS" && side === "C") return "Cancel";
    if (status === "CC") return "Cancelled";
    return [status, side].filter(Boolean).join(" ");
  }

  function receiptType(row) {
    var code = String(row.RECEIPT_TYPE || "").trim();
    var name = TYPE_NAME[code];
    return name ? code + " " + name : code;
  }

  function namedStatus(row, names) {
    var code = String(row.STATUS_CDE || "").trim();
    return names[code] ? names[code] : code;
  }

  function tone(text) {
    if (text === "Create" || text === "Chargeable" || text === "Open" || text === "Active") return "mark-go";
    if (text === "Cancel" || text === "Cancelled" || text === "Not charged" || text === "Voided") return "mark-stop";
    return "";
  }

  var LIST_SPEC = {
    receipts: [
      { key: "HOSPITAL_CDE", label: "Hospital" },
      { key: "RECEIPT_NO", label: "Receipt" },
      { key: "CASE_NO", label: "Case" },
      { key: "AT_TIME", label: "Time" },
      { key: "RECEIPT_AMT", label: "Amount" },
      { key: "PAYMENT_MEANS", label: "Payment" },
      { key: "FC_USER", label: "User" },
      { key: "FC_WS", label: "Workstation" },
      { label: "Type", value: receiptType },
      { label: "What happened", value: receiptEvent }
    ],
    charge: [
      { key: "HOSPITAL_CDE", label: "Hospital" },
      { key: "CASE_NO", label: "Case" },
      { key: "MOE_ORDER_NO", label: "MOE order" },
      { key: "SEQ_NO", label: "Item" },
      { key: "AT_TIME", label: "Written" },
      { key: "CHARGE_AMT", label: "Amount" },
      { key: "FC_USER", label: "User" },
      { key: "FC_WS", label: "Workstation" },
      { label: "Line", value: function (row) { return namedStatus(row, { IS: "Chargeable", CC: "Not charged" }); } }
    ],
    case: [
      { key: "HOSPITAL_CDE", label: "Hospital" },
      { key: "CASE_NO", label: "Case" },
      { key: "SERVICE_CDE", label: "Service" },
      { key: "AT_TIME", label: "Updated" },
      { key: "ITEM_CNT", label: "Items" },
      { key: "CHARGE_AMT", label: "Amount" },
      { label: "Header", value: function (row) { return namedStatus(row, { IS: "Open", CC: "Cancelled" }); } }
    ],
    sfi: [
      { key: "HOSPITAL_CDE", label: "Hospital" },
      { key: "CASE_NO", label: "Case" },
      { key: "SFI_INV_NO", label: "Invoice" },
      { key: "AT_TIME", label: "Written" },
      { key: "CHARGE_AMT", label: "Amount" },
      { label: "Invoice state", value: function (row) { return namedStatus(row, { IS: "Active", CC: "Voided" }); } }
    ]
  };

  var LIST_NOTE = {
    receipts: "Create is an issued debit (IS, D). Cancel is an issued credit (IS, C) written at the cancel time, so it can be a later day than the create. The original debit is then marked CC and is not in this list.",
    charge: "Chargeable is status IS. Not charged is status CC. The detail trigger writes CC when the line is not chargeable.",
    case: "Open is status IS. Cancelled is status CC. One case service can cover many drug charging rows.",
    sfi: "Active is status IS. Voided is status CC."
  };

  function recentPanel(data) {
    var header = data.recentHeader;
    var detail = data.recentDetail;
    var rows = (header && header.ran && header.rows && header.rows.length) ? header.rows : ((detail && detail.rows) || []);
    var labels = rows.map(function (row) { return row.time; });
    var series = [
      pointSeries("med_profile_charge_hdr", "#2f6f9f", header, labels),
      pointSeries("med_profile_charge_detail", "#7aa2c4", detail, labels)
    ];
    var sql = [header, detail].map(function (block) {
      if (!block || !block.sql) return "";
      return block.label + "\n" + block.sql;
    }).filter(Boolean).join("\n\n");
    var reasons = [header, detail].filter(function (block) { return block && !block.ran && block.reason; }).map(function (block) {
      return block.label + ": " + block.reason;
    });
    return '<section class="health-panel">' + panelHead("Med profile tables, last hour") +
      '<p class="src">One hospital. Time across, count up. The time is create_dtm on the row, the MOE order create time, for the last hour on the database clock.</p>' +
      lineSvg(labels, series, { time: true, labelEvery: 10, yName: "Count", xName: "Time" }) +
      (reasons.length ? '<p class="muted">' + escapeText(reasons.join(" ")) + '</p>' : '') +
      sqlBlock(sql) + '</section>';
  }

  function pointSeries(name, color, block, labels) {
    var by = {};
    if (block && block.ran && block.rows) block.rows.forEach(function (row) { by[row.time] = row.count || 0; });
    return {
      name: name,
      color: color,
      values: labels.map(function (label) { return block && block.ran ? (by[label] || 0) : null; }),
      active: !!(block && block.ran)
    };
  }

  function hourPanel(title, note, pairs) {
    var series = pairs.map(function (pair) { return seriesFromHours(pair[0], pair[1], pair[2]); });
    var reasons = pairs.filter(function (pair) { return pair[2] && !pair[2].ran && pair[2].reason; }).map(function (pair) {
      return pair[0] + ": " + pair[2].reason;
    });
    var sql = pairs.map(function (pair) {
      if (!pair[2] || !pair[2].sql) return "";
      return pair[0] + "\n" + pair[2].sql;
    }).filter(Boolean).join("\n\n");
    return '<section class="health-panel">' + panelHead(title) + '<p class="src">' + escapeText(note) + '</p>' +
      lineSvg(timeLabels(), series, { time: true, yName: "Count", xName: "Time" }) +
      (reasons.length ? '<p class="muted">' + escapeText(reasons.join(" ")) + '</p>' : '') +
      sqlBlock(sql) + '</section>';
  }

  function receiptPanel(data) {
    var types = data.receiptTypes;
    var sql = (types && types.sql) || (data.receiptHours && data.receiptHours.sql) || "";
    var series = typeSeries(types).map(function (pair) { return seriesFromHours(pair[0], pair[1], pair[2]); });
    return '<section class="health-panel">' + panelHead("Saved receipts") +
      '<p class="src">' + escapeText(receiptTypeNote(types)) + '</p>' +
      '<h3>By type</h3><p class="src">Receipt type across, count up. A type with no saves stays at zero.</p>' +
      typeBars(types) +
      '<h3>By time</h3><p class="src">Time across, count up. Each line is one receipt type.</p>' +
      lineSvg(timeLabels(), series, { time: true, yName: "Count", xName: "Time" }) +
      sqlBlock(sql) + '</section>';
  }

  function panelHead(title) {
    return '<div class="panel-head"><h2>' + escapeText(title) + '</h2><button type="button" class="sql-toggle" aria-expanded="false">SQL</button></div>';
  }

  function sqlBlock(sql) {
    var text = sql ? String(sql) : "No query was run for this graph.";
    return '<pre class="sql-block" hidden>' + escapeText(text) + '</pre>';
  }

  function typeBars(block) {
    if (!block || !block.ran) return '<p class="muted">' + escapeText(block && block.reason || "Enter a hospital and run the check.") + '</p>';
    var rows = block.rows || [];
    if (!rows.length) return '<p class="muted">No receipt types on this day.</p>';
    return barSvg(
      rows.map(function (row) {
        var code = String(row.type || "").trim();
        var name = TYPE_NAME[code] || "Other";
        return { label: code || "—", tip: (code || "—") + " " + name + " · " + formatNum(row.count || 0) };
      }),
      rows.map(function (row) { return row.count || 0; }),
      rows.map(function (row) { return TYPE_COLOR[String(row.type || "").trim()] || "#5c6b7a"; })
    );
  }

  var TYPE_COLOR = { DR: "#2f6f9f", DD: "#c47a2c", DF: "#2f8f62", DV: "#8a5a9a", DH: "#b23b3b" };

  function typeSeries(block) {
    if (!block || !block.ran) return [["Receipts", "#2f8f62", block]];
    var rows = block.rows || [];
    if (!rows.length) return [["Receipts", "#2f8f62", { ran: true, rows: timeLabels().map(function (label) { return { hour: label.slice(0, 2), count: 0 }; }) }]];
    return rows.map(function (row) {
      var code = String(row.type || "").trim();
      var name = code + " " + (TYPE_NAME[code] || "Other") + " " + formatNum(row.count || 0);
      var hours = row.hours && row.hours.length ? row.hours : timeLabels().map(function (label) { return { hour: label.slice(0, 2), count: 0 }; });
      return [name, TYPE_COLOR[code] || "#5c6b7a", { ran: true, rows: hours }];
    });
  }

  function seriesFromHours(name, color, block) {
    var values = [];
    for (var h = 0; h < 24; h++) values.push(null);
    if (block && block.ran && block.rows) {
      block.rows.forEach(function (row) {
        var hour = Number(row.hour);
        if (hour >= 0 && hour < 24) values[hour] = row.count || 0;
      });
    }
    return { name: name, color: color, values: values, block: block, active: !!(block && block.ran) };
  }

  function timeLabels() {
    var labels = [];
    for (var h = 0; h < 24; h++) labels.push((h < 10 ? "0" : "") + h + ":00");
    return labels;
  }

  function ageLine(rows, hosp) {
    if (!rows.length) return '<p class="muted">No rows in sysmon_moe_rep.</p>';
    var ordered = rows.slice().sort(function (a, b) { return String(a.hospital || "").localeCompare(String(b.hospital || "")); });
    var values = ordered.map(function (row) { return row.ageMin == null ? null : Number(row.ageMin); });
    var labels = ordered.map(function (row) { return row.hospital || ""; });
    var tips = ordered.map(function (row) {
      return (row.hospital || "") + " · " + (row.ageMin == null ? "no time" : Math.round(row.ageMin) + " min") + (row.lastUpd ? " · " + row.lastUpd : "");
    });
    var marks = ordered.map(function (row) {
      return hosp && String(row.hospital || "").toUpperCase() === hosp ? "#2f6f9f" : "";
    });
    var always = {};
    ordered.forEach(function (row, i) {
      if (hosp && String(row.hospital || "").toUpperCase() === hosp) always[i] = true;
    });
    return lineSvg(labels, [{ name: "Minutes", color: "#2f6f9f", values: values, active: true, tips: tips, marks: marks }], { always: always });
  }

  function seatLine(seats) {
    if (!seats || !seats.ran) return '<p class="muted">Enter a hospital and run the check.</p>';
    if (!seats.rows.length) return '<p class="muted">No seats for this hospital.</p>';
    return lineSvg(
      seats.rows.map(function (row) { return row.sys || "—"; }),
      [{
        name: "Active seats",
        color: "#2f6f9f",
        values: seats.rows.map(function (row) { return row.active || 0; }),
        active: true,
        tips: seats.rows.map(function (row) { return (row.sys || "—") + " · " + row.active + " of " + row.seats + (row.latest ? " · " + row.latest : ""); })
      }]
    );
  }

  function lineSvg(labels, series, opt) {
    opt = opt || {};
    var active = series.filter(function (item) { return item.active; });
    if (!active.length || !labels.length) return "";
    var w = 760;
    var crowded = !opt.time && labels.length > 12;
    var h = crowded ? 280 : 230;
    var padL = 42;
    var padR = 12;
    var padT = 16;
    var padB = crowded ? 68 : 32;
    var innerW = w - padL - padR;
    var innerH = h - padT - padB;
    var max = 1;
    var min = 0;
    active.forEach(function (item) {
      item.values.forEach(function (value) {
        if (value == null || isNaN(value)) return;
        if (value > max) max = value;
        if (value < min) min = value;
      });
    });
    if (max === min) max = min + 1;
    function xAt(i) {
      if (labels.length <= 1) return padL + innerW / 2;
      return padL + i / (labels.length - 1) * innerW;
    }
    function yAt(value) {
      return padT + innerH - ((value - min) / (max - min)) * innerH;
    }
    var grid = [max, (max + min) / 2, min].map(function (value) {
      var y = yAt(value);
      var text = formatNum(Math.round(value));
      return '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" class="line-grid"></line>' +
        '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end" class="line-axis">' + escapeText(text) + '</text>';
    }).join("");
    var every = opt.labelEvery || (opt.time ? 4 : (crowded ? 4 : 1));
    var axis = labels.map(function (label, i) {
      if (i % every !== 0 && i !== labels.length - 1 && !(opt.always && opt.always[i])) return "";
      var x = xAt(i);
      var y = h - (crowded ? 6 : 8);
      var rotate = crowded ? ' transform="rotate(-50 ' + round1(x) + ' ' + y + ')"' : '';
      return '<text x="' + x + '" y="' + y + '" text-anchor="' + (crowded ? "end" : "middle") + '" class="line-axis"' + rotate + '>' + escapeText(label) + '</text>';
    }).join("");
    var paths = active.map(function (item) {
      var d = "";
      var pen = false;
      var dots = item.values.map(function (value, i) {
        if (value == null || isNaN(value)) { pen = false; return ""; }
        var x = round1(xAt(i));
        var y = round1(yAt(value));
        d += (pen ? "L" : "M") + x + " " + y + " ";
        pen = true;
        var tip = item.tips ? item.tips[i] : item.name + " · " + labels[i] + " · " + formatNum(value);
        var marked = item.marks && item.marks[i];
        var fill = marked || item.color;
        return '<circle cx="' + x + '" cy="' + y + '" r="' + (marked ? 5 : 3.2) + '" fill="' + fill + '"><title>' + escapeText(tip) + '</title></circle>';
      }).join("");
      return '<path d="' + d.trim() + '" fill="none" stroke="' + item.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>' + dots;
    }).join("");
    var legend = active.map(function (item) {
      return '<span class="line-key"><i style="background:' + item.color + '"></i>' + escapeText(item.name) + '</span>';
    }).join("");
    var captions = opt.yName || opt.xName ? '<div class="axis-caption"><span>' + escapeText(opt.yName || "") + '</span><span>' + escapeText(opt.xName || "") + '</span></div>' : "";
    return captions + '<div class="line-legend">' + legend + '</div><svg class="line-svg" viewBox="0 0 ' + w + ' ' + h + '" role="img">' + grid + paths + axis + '</svg>';
  }

  function barSvg(labels, values, colors) {
    var w = 760;
    var h = 230;
    var padL = 42;
    var padR = 16;
    var padT = 16;
    var padB = 48;
    var innerW = w - padL - padR;
    var innerH = h - padT - padB;
    var max = 1;
    values.forEach(function (value) { if (value > max) max = value; });
    var gap = innerW / labels.length;
    var barW = Math.max(8, Math.min(48, gap * 0.55));
    var grid = [max, max / 2, 0].map(function (value) {
      var y = padT + innerH - (value / max) * innerH;
      return '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" class="line-grid"></line>' +
        '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end" class="line-axis">' + escapeText(formatNum(Math.round(value))) + '</text>';
    }).join("");
    var bars = labels.map(function (label, i) {
      var value = values[i] || 0;
      var drawn = Math.max(value ? 2 : 1, (value / max) * innerH);
      var x = padL + gap * i + (gap - barW) / 2;
      var y = padT + innerH - drawn;
      var text = label && label.label != null ? label.label : label;
      var tip = label && label.tip != null ? label.tip : text + " · " + formatNum(value);
      return '<rect x="' + round1(x) + '" y="' + round1(y) + '" width="' + round1(barW) + '" height="' + round1(drawn) + '" fill="' + colors[i] + '" rx="2"><title>' + escapeText(tip) + '</title></rect>' +
        '<text x="' + round1(x + barW / 2) + '" y="' + (h - 16) + '" text-anchor="middle" class="line-axis">' + escapeText(text) + '</text>';
    }).join("");
    return '<div class="axis-caption"><span>Count</span><span>Receipt type</span></div><svg class="line-svg" viewBox="0 0 ' + w + ' ' + h + '" role="img">' + grid + bars + '</svg>';
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  var TYPE_NAME = { DR: "Charged", DD: "Zero drug", DF: "Free", DV: "Waiver", DH: "HA or SFI mean" };

  function flowPanel(data) {
    var steps = data.flow || [];
    if (!steps.length) return "";
    var body = steps.map(function (step) {
      var warn = step.id === "exc";
      var tone = "off";
      if (step.ran && warn && step.count > 0) tone = "bad";
      else if (step.ran && step.count > 0) tone = "ok";
      else if (step.ran) tone = warn ? "ok" : "quiet";
      var value = step.ran ? formatNum(step.count) : "Not counted";
      var detail = step.ran ? ((step.latest ? "Latest " + step.latest : "None on this day") + (step.source ? " · " + step.source : "")) : (step.reason || "");
      var arrow = step.id === "hdr" || step.id === "detail" || step.id === "charge" ? '<span class="flow-arrow" aria-hidden="true">→</span>' : "";
      return '<article class="flow-step ' + tone + '"><div class="k">' + escapeText(step.label) + '</div><div class="v">' + escapeText(value) + '</div><div class="s">' + escapeText(detail) + '</div></article>' + arrow;
    }).join("");
    return '<section class="health-panel"><h2>Flow on ' + escapeText(data.day || "this day") + '</h2><p class="src">Header, then the detail path into drug charging and case services. SFI charging is the SFI create path. A blank step was not counted, so the table was not scanned.</p><div class="flow-line">' + body + '</div></section>';
  }

  function receiptTypeNote(block) {
    if (!block || !block.ran) return block && block.reason || "";
    return (block.source || "fc_receipts") + " · status IS, debit · " + formatNum(total(block)) + " on this day";
  }

  function card(k, v, s) {
    return '<article class="health-card"><div class="k">' + escapeText(k) + '</div><div class="v">' + escapeText(v) + '</div><div class="s">' + escapeText(s) + '</div></article>';
  }

  function total(block) {
    if (!block || !block.rows) return 0;
    return block.rows.reduce(function (sum, row) { return sum + (row.count || 0); }, 0);
  }

  function formatNum(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function escapeText(text) {
    return String(text == null ? "" : text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escapeAttr(text) {
    return escapeText(text).replace(/"/g, "&quot;");
  }
})();
