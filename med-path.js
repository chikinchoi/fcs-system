(function () {
  var HOSP_KEY = "fcs-system:health:hospital";
  var CONNECT_KEY = "fcs-system:health:connect";
  var USER_KEY = "fcs-system:health:user";
  var root = document.getElementById("view-path");
  if (!root) return;
  var hospital = localStorage.getItem(HOSP_KEY) || "";
  var connect = localStorage.getItem(CONNECT_KEY) || "";
  var user = localStorage.getItem(USER_KEY) || "";
  var running = false;
  var stopCtrl = null;

  render();
  root.addEventListener("input", onInput);
  root.addEventListener("click", onClick);

  function onInput(e) {
    var id = e.target.id;
    if (id === "path-hospital") hospital = e.target.value;
    if (id === "path-connect") connect = e.target.value;
    if (id === "path-user") user = e.target.value;
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
      return;
    }
    if (e.target.id === "path-stop") {
      stop();
      return;
    }
    if (e.target.id !== "path-run") return;
    run();
  }

  function applyRange(kind) {
    var day = new Date();
    if (kind === "yesterday") day.setDate(day.getDate() - 1);
    setClock("path-start", day, "00:00");
    setClock("path-end", day, "23:59");
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
      '<div class="dash-top"><h1>CMS path healthness</h1><p class="src">Password is used for this check and is not stored. One database session is opened for this page and closed when the load finishes. Disconnect closes it sooner. Each read stops after 8 seconds. This session is not the MOE and receipts session. The read is the newest tlog row in each table. The date and hospital boxes match that page and are not applied, because the index can return one newest row for the whole table.</p></div>' +
      '<div class="reg-fields">' +
      '<label class="wide">Connection string<input id="path-connect" class="url" spellcheck="false" placeholder="host:port/service" autocomplete="off" value="' + escapeAttr(connect) + '"></label>' +
      '<label>Username<input id="path-user" spellcheck="false" autocomplete="off" value="' + escapeAttr(user) + '"></label>' +
      '<label>Password<input id="path-pass" type="password" autocomplete="off"></label>' +
      '<label>Hospital<input id="path-hospital" class="short" maxlength="10" spellcheck="false" placeholder="All" value="' + escapeAttr(hospital) + '"></label>' +
      '<label>Start date<input id="path-start-date" type="date"></label>' +
      '<label>Start time<input id="path-start-time" class="clock" inputmode="numeric" maxlength="5" spellcheck="false" placeholder="HH:MM" autocomplete="off"></label>' +
      '<label>End date<input id="path-end-date" type="date"></label>' +
      '<label>End time<input id="path-end-time" class="clock" inputmode="numeric" maxlength="5" spellcheck="false" placeholder="HH:MM" autocomplete="off"></label>' +
      '<button type="button" data-range="yesterday">Yesterday</button>' +
      '<button type="button" data-range="today">Today</button>' +
      '<button type="button" id="path-run" class="primary">Connect and load</button>' +
      '<button type="button" id="path-stop" class="danger" disabled>Disconnect</button>' +
      '</div>' +
      '<p id="path-msg" class="need" role="status"></p>' +
      '<div id="path-out"></div>' +
      '</div>';
    document.getElementById("path-out").innerHTML = '<p class="muted">Enter the database login and press Connect and load. Today is 00:00 through 23:59.</p>';
    applyRange("today");
  }

  function run() {
    if (running) return;
    connect = document.getElementById("path-connect").value;
    user = document.getElementById("path-user").value;
    hospital = document.getElementById("path-hospital").value;
    var start = readStamp("path-start");
    var end = readStamp("path-end");
    localStorage.setItem(HOSP_KEY, hospital);
    localStorage.setItem(CONNECT_KEY, connect);
    localStorage.setItem(USER_KEY, user);
    var pass = document.getElementById("path-pass").value;
    var problems = [];
    if (!connect.trim() || !user.trim() || !pass) problems.push("Connection string, username, and password are required.");
    if (hospital.trim() && !/^[A-Za-z0-9]{1,10}$/.test(hospital.trim())) problems.push("Hospital is 1–10 letters or digits.");
    if (start == null || end == null) problems.push("Choose a date. Time is 24-hour HH:MM, from 00:00 to 23:59.");
    else if ((start && !end) || (!start && end)) problems.push("Enter both a start and an end.");
    var msg = document.getElementById("path-msg");
    msg.textContent = problems.join(" ");
    if (problems.length) return;
    if (location.protocol === "file:") {
      msg.textContent = "Open http://127.0.0.1:8770/ after node regression-proxy.js. A file page cannot reach the database.";
      return;
    }
    running = true;
    document.getElementById("path-run").disabled = true;
    document.getElementById("path-stop").disabled = false;
    msg.textContent = "Reading. Disconnect closes this session if it runs too long. A query also stops after 8 seconds.";
    stopCtrl = new AbortController();
    fetch("/med-path", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      signal: stopCtrl.signal,
      body: JSON.stringify({
        connectString: connect.trim(),
        user: user.trim(),
        password: pass,
        hospital: hospital.trim(),
        start: start,
        end: end
      })
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (pack) {
      if (!pack.ok) throw new Error(pack.body && pack.body.error || "The check failed.");
      paint(pack.body);
      msg.textContent = "";
    }).catch(function (err) {
      if (err && err.name === "AbortError") msg.textContent = "Disconnected. The database session was closed.";
      else msg.textContent = err && err.message ? err.message : "The runner did not answer. Start node regression-proxy.js and open http://127.0.0.1:8770/.";
    }).then(function () {
      running = false;
      stopCtrl = null;
      var btn = document.getElementById("path-run");
      var stopBtn = document.getElementById("path-stop");
      if (btn) btn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
    });
  }

  function stop() {
    if (!running) return;
    var msg = document.getElementById("path-msg");
    if (msg) msg.textContent = "Disconnecting. The database session is being closed.";
    if (stopCtrl) stopCtrl.abort();
    fetch("/med-path/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: "{}"
    }).catch(function () {});
  }

  function paint(data) {
    var today = String(data.now || "").slice(0, 10);
    var rows = data.rows || [];
    var body = rows.map(function (row) {
      var when = row.ran ? (row.at || "No rows") : "Not read";
      var mark = "";
      if (row.ran && row.at && today && row.at.slice(0, 10) === today) mark = "mark-go";
      else if (row.ran && row.at) mark = "mark-stop";
      return "<tr><td>" + escapeText(row.label) + "</td><td>" + escapeText(row.table) + "</td><td class=\"" + mark + "\">" + escapeText(when) + "</td><td>" + escapeText(row.ran ? (row.hospital || "—") : "—") + "</td><td>" + escapeText(row.ran ? (row.orderNo || "—") : "—") + "</td></tr>";
    }).join("");
    var notes = rows.filter(function (row) { return !row.ran && row.reason; }).map(function (row) {
      return '<p class="need">' + escapeText(row.label + ": " + row.reason) + "</p>";
    }).join("");
    document.getElementById("path-out").innerHTML =
      '<p class="src">' + escapeText(data.now ? "database " + data.now : "") + "</p>" +
      notes +
      (body ? '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Log</th><th>Table</th><th>Logged at</th><th>Hospital</th><th>MOE order</th></tr></thead><tbody>' + body + "</tbody></table></div>" : "") +
      '<section class="health-panel"><h2>SQL</h2><pre class="sql-block">' + escapeText((data.sql || []).join("\n\n")) + "</pre></section>";
  }

  function escapeText(text) {
    return String(text == null ? "" : text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escapeAttr(text) {
    return escapeText(text).replace(/"/g, "&quot;");
  }
})();
