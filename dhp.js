(function () {
  var HOSP_KEY = "fcs-system:dhp:hospital";
  var CONNECT_KEY = "fcs-system:health:connect";
  var USER_KEY = "fcs-system:health:user";
  var root = document.getElementById("view-dhp");
  var hospital = localStorage.getItem(HOSP_KEY) || "HHH";
  var connect = localStorage.getItem(CONNECT_KEY) || "";
  var user = localStorage.getItem(USER_KEY) || "";
  var running = false;
  var stopCtrl = null;
  var selected = "";

  render();
  root.addEventListener("input", onInput);
  root.addEventListener("click", onClick);

  function onInput(e) {
    var id = e.target.id;
    if (id === "dhp-hospital") hospital = e.target.value;
    if (id === "dhp-connect") connect = e.target.value;
    if (id === "dhp-user") user = e.target.value;
    localStorage.setItem(HOSP_KEY, hospital);
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
      selected = "";
      run();
      return;
    }
    var pick = e.target.getAttribute && e.target.getAttribute("data-log");
    if (pick) {
      selected = pick;
      run();
      return;
    }
    if (e.target.id === "dhp-stop") {
      stop();
      return;
    }
    if (e.target.id !== "dhp-run") return;
    selected = "";
    run();
  }

  function applyRange(kind) {
    var day = new Date();
    if (kind === "yesterday") day.setDate(day.getDate() - 1);
    setClock("dhp-start", day, "00:00");
    setClock("dhp-end", day, "23:59");
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
      '<div class="dash-top"><h1>DHP before and after</h1><p class="src">HHH is the first hospital on the new endpoint. Connect and load counts the new-endpoint calls in the range. Compare calls the old SOAP endpoint for that one request and checks the fields the payment code stores. Handled means the mapping already stores the same result. Password is used for this check and is not stored. The database read does not write.</p></div>' +
      '<div class="reg-fields">' +
      '<label class="wide">Connection string<input id="dhp-connect" class="url" spellcheck="false" placeholder="host:port/service" autocomplete="off" value="' + escapeAttr(connect) + '"></label>' +
      '<label>Username<input id="dhp-user" spellcheck="false" autocomplete="off" value="' + escapeAttr(user) + '"></label>' +
      '<label>Password<input id="dhp-pass" type="password" autocomplete="off"></label>' +
      '<label>Hospital<input id="dhp-hospital" class="short" maxlength="10" spellcheck="false" value="' + escapeAttr(hospital) + '"></label>' +
      '<label>Start date<input id="dhp-start-date" type="date"></label>' +
      '<label>Start time<input id="dhp-start-time" class="clock" inputmode="numeric" maxlength="5" spellcheck="false" placeholder="HH:MM" autocomplete="off"></label>' +
      '<label>End date<input id="dhp-end-date" type="date"></label>' +
      '<label>End time<input id="dhp-end-time" class="clock" inputmode="numeric" maxlength="5" spellcheck="false" placeholder="HH:MM" autocomplete="off"></label>' +
      '<button type="button" data-range="yesterday">Yesterday</button>' +
      '<button type="button" data-range="today">Today</button>' +
      '<button type="button" id="dhp-run" class="primary">Connect and load</button>' +
      '<button type="button" id="dhp-stop" class="danger" disabled>Disconnect</button>' +
      '</div>' +
      '<p id="dhp-msg" class="need" role="status"></p>' +
      '<div id="dhp-out"></div>' +
      '</div>';
    document.getElementById("dhp-out").innerHTML = '<p class="muted">Enter the database login and press Connect and load. Today is 00:00 through 23:59. The end minute is included.</p>';
    applyRange("today");
  }

  function run() {
    if (running) return;
    connect = document.getElementById("dhp-connect").value;
    user = document.getElementById("dhp-user").value;
    hospital = document.getElementById("dhp-hospital").value;
    var start = readStamp("dhp-start");
    var end = readStamp("dhp-end");
    localStorage.setItem(HOSP_KEY, hospital);
    localStorage.setItem(CONNECT_KEY, connect);
    localStorage.setItem(USER_KEY, user);
    var pass = document.getElementById("dhp-pass").value;
    var problems = [];
    if (!connect.trim() || !user.trim() || !pass) problems.push("Connection string, username, and password are required.");
    if (start == null || end == null) problems.push("Choose a date. Time is 24-hour HH:MM, from 00:00 to 23:59.");
    else if ((start && !end) || (!start && end)) problems.push("Enter both a start and an end.");
    var msg = document.getElementById("dhp-msg");
    msg.textContent = problems.join(" ");
    if (problems.length) return;
    if (location.protocol === "file:") {
      msg.textContent = "Open http://127.0.0.1:8770/ after node regression-proxy.js. A file page cannot reach the database.";
      return;
    }
    running = true;
    document.getElementById("dhp-run").disabled = true;
    document.getElementById("dhp-stop").disabled = false;
    msg.textContent = "Reading. The session is read only.";
    stopCtrl = new AbortController();
    fetch("/dhp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        connectString: connect.trim(),
        user: user.trim(),
        password: pass,
        hospital: hospital.trim(),
        start: start,
        end: end,
        id: selected
      }),
      signal: stopCtrl.signal
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (result) {
      if (!result.ok) throw new Error(result.body && result.body.error || "The check failed.");
      paint(result.body);
      msg.textContent = "";
    }).catch(function (err) {
      if (err && err.name === "AbortError") msg.textContent = "Disconnected.";
      else msg.textContent = err.message || "The check failed.";
    }).then(function () {
      running = false;
      stopCtrl = null;
      var btn = document.getElementById("dhp-run");
      var stopBtn = document.getElementById("dhp-stop");
      if (btn) btn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
    });
  }

  function stop() {
    if (stopCtrl) stopCtrl.abort();
    fetch("/dhp/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: "{}"
    }).catch(function () {});
  }

  function paint(data) {
    var flag = data.flag || "blank";
    var warnings = (data.warnings || []).map(function (text) {
      return '<p class="need">' + escapeText(text) + '</p>';
    }).join("");
    var triggers = data.triggers || [];
    var rows = triggers.map(function (item) {
      var on = String(item.id) === String(data.selected) ? ' class="primary"' : "";
      return "<tr><td>" + escapeText(item.at) + "</td><td>" + escapeText(item.source || item.wsKey) + "</td><td>" + escapeText(item.endpoint) + "</td><td>" + escapeText(item.caseNo) + "</td><td>" + escapeText(item.apptSeq) + "</td><td>" + escapeText(item.responseCode) + '</td><td><button type="button" data-log="' + escapeAttr(item.id) + '"' + on + ">Compare</button></td></tr>";
    }).join("");
    var table = triggers.length
      ? '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>When</th><th>Call</th><th>Endpoint</th><th>Case</th><th>Appt seq</th><th>HTTP</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>"
      : '<p class="muted">No new-endpoint call for this hospital in this range.</p>';
    document.getElementById("dhp-out").innerHTML =
      '<div class="health-cards"><article class="health-card"><div class="k">USE_DHP_NEW_ENDPOINT</div><div class="v">' + escapeText(flag) + '</div><div class="s">' + escapeText(data.hospital || "") + "</div></article></div>" +
      '<p class="src">' + escapeText(data.verdict || "") + "</p>" +
      warnings +
      '<p class="src">' + escapeText((data.start || "") + " to " + (data.end || "") + " · database " + (data.now || "")) + "</p>" +
      flowTable(data.flows, data.coverage) +
      '<section class="health-panel"><h2>New-endpoint calls</h2><p class="src">These rows are the calls that recorded <span class="mono">_logSource</span>. That marker is written by the billing web app and by fcs-core-svc. Kiosk and PayHA are not in this list. Compare calls the old SOAP endpoint for that one request. The endpoint column is the path from FCS_CONFIG_PARAMETER, without the host.</p>' + table + "</section>" +
      compareHtml(data.compare) +
      '<section class="health-panel"><div class="panel-head"><h2>SQL</h2><button type="button" class="sql-toggle" aria-expanded="false">SQL</button></div><pre class="sql-block" hidden>' + escapeText((data.sql || []).join("\n\n")) + "</pre></section>";
  }

  function flowTable(flows, coverage) {
    var rows = (flows || []).map(function (row) {
      var state = !row.n ? "Not seen" : (row.bad ? row.bad + " failed" : "Success");
      var cls = !row.n ? "" : (row.bad ? "mark-diff" : "mark-go");
      return "<tr><td>" + escapeText(row.label) + "</td><td>" + escapeText(row.entry || "") + "</td><td>" + escapeText(row.endpoint) + "</td><td>" + escapeText(row.n) + "</td><td class=\"" + cls + "\">" + escapeText(state) + "</td><td>" + escapeText(row.last) + "</td></tr>";
    }).join("");
    return '<section class="health-panel"><h2>DHP paths</h2><p class="src">' + escapeText(coverage || "") + " These seven rows are the entry points that check USE_DHP_NEW_ENDPOINT and then write _logSource. The flag itself is only shown above. A call is counted when that marker and this hospital are in the log. Not seen means that scenario did not run in the rows read. A source that is not one of these seven is added when the log contains it. Kiosk and PayHA use the flag but do not write this marker. MAM in fcs-core-svc still calls SOAP, so a MAM screen there stays Not seen even when the flag is Y.</p><div class=\"dash-table-wrap\"><table class=\"dash-table\"><thead><tr><th>Scenario</th><th>Entry</th><th>Endpoint</th><th>Calls</th><th>Result</th><th>Latest</th></tr></thead><tbody>" + rows + "</tbody></table></div></section>";
  }

  function compareHtml(block) {
    if (!block) return "";
    if (block.error) return '<p class="need">' + escapeText(block.error) + "</p>";
    var counts = block.counts || {};
    var head = '<section class="health-panel"><h2>' + escapeText(block.source || "Call") + " · " + escapeText(block.at || "") + "</h2>" +
      '<p class="src">New log ' + escapeText(block.id || "") +
      ". Same " + escapeText(counts.Same || 0) + ", handled " + escapeText(counts.Handled || 0) + ", differs " + escapeText(counts.Differs || 0) +
      ". Charge " + escapeText(counts.Charge || 0) + ", visit " + escapeText(counts.Visit || 0) + ", screen " + escapeText(counts.Screen || 0) + ", record " + escapeText(counts.Record || 0) + ", review " + escapeText(counts.Review || 0) +
      ". A production change is for Charge or Visit only. Screen and Record can stay. Review is a field this page has not classified yet. Matching rows are shortened after 40. Old endpoint is the SOAP value. New raw is the JSON value before mapping. New after code is the value the payment code stores after renaming and formatting. Same means that stored value matches the SOAP value. Handled means the raw JSON differed and the mapping makes it match. Differs means the stored value still does not match. A block titled only on old was in the SOAP response and had no paired row in the new response.</p>" +
      (/PATIENT/i.test(block.source) ? '<p class="src">This path stores the patient block. Appointment fields in the same payload are not stored by that parser.</p>' : "") +
      (block.note ? '<p class="src">' + escapeText(block.note) + "</p>" : "") +
      payloadHtml(block);
    var groups = (block.groups || []).map(function (group) {
      var body = (group.rows || []).map(function (row) {
        return "<tr><td>" + escapeText(row.field) + "</td><td>" + escapeText(row.old) + "</td><td>" + escapeText(row.raw) + "</td><td>" + escapeText(row.mapped) + '</td><td class="' + codeClass(row.code) + '">' + escapeText(row.code) + '</td><td class="' + impactClass(row) + '">' + escapeText(row.impact || "") + "</td><td>" + escapeText(affectText(row)) + "</td></tr>";
      }).join("");
      return "<h2>" + escapeText(group.title || "") + '</h2><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Field</th><th>Old endpoint</th><th>New raw</th><th>New after code</th><th>Code</th><th>Impact</th><th>What it affects</th></tr></thead><tbody>' + body + "</tbody></table></div>";
    }).join("");
    return head + groups + "</section>";
  }

  function payloadHtml(block) {
    var payloads = block.payloads || {};
    function column(title, request, response) {
      return '<div class="payload-col"><h3>' + escapeText(title) + "</h3>" +
        "<h3>Request</h3><pre class=\"payload-block\">" + escapeText(request || "") + "</pre>" +
        "<h3>Response</h3><pre class=\"payload-block\">" + escapeText(response || "") + "</pre></div>";
    }
    return '<div class="panel-head"><h2>Requests and responses</h2><button type="button" class="sql-toggle" aria-expanded="false">Show</button></div>' +
      '<div class="sql-block payload-wrap" hidden><div class="payload-split">' +
      column("New endpoint", payloads.newRequest, payloads.newResponse) +
      column("Old endpoint", payloads.oldRequest, payloads.oldResponse) +
      "</div></div>";
  }

  function affectText(row) {
    var impact = row.impactWhy || "";
    var reason = row.reason || "";
    if (impact && reason && reason !== impact) return impact + " " + reason;
    return impact || reason;
  }

  function codeClass(code) {
    if (code === "Same") return "mark-go";
    if (code === "Handled") return "mark-handled";
    if (code === "Differs") return "mark-diff";
    return "";
  }

  function impactClass(row) {
    if (!row || row.code !== "Differs") return "mark-go";
    if (row.impact === "Charge" || row.impact === "Visit") return "mark-diff";
    if (row.impact === "Review") return "mark-review";
    return "mark-handled";
  }

  function escapeText(value) {
    return String(value == null ? "" : value).replace(/[&<>]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch];
    });
  }

  function escapeAttr(value) {
    return escapeText(value).replace(/"/g, "&quot;");
  }
})();
