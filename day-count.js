(function () {
  var CONNECT_KEY = "fcs-system:health:connect";
  var USER_KEY = "fcs-system:health:user";
  var DAY_KEY = "fcs-system:day:date";
  var root = document.getElementById("view-day");
  var connect = localStorage.getItem(CONNECT_KEY) || "";
  var user = localStorage.getItem(USER_KEY) || "";
  var running = false;
  var stopCtrl = null;
  var DHP_ROLLOUT = {
    HHH: "2026-11-02", CHC: "2026-11-02", CHS: "2026-11-02",
    BBH: "2026-11-05", FYK: "2026-11-05", ML: "2026-11-05", WCH: "2026-11-05",
    DKC: "2026-11-09", SJH: "2026-11-09", TYH: "2026-11-09", SLH: "2026-11-09",
    BH: "2026-11-12", HKE: "2026-11-12", GH: "2026-11-12",
    KH: "2026-11-16", SH: "2026-11-16", TPH: "2026-11-16", WTS: "2026-11-16",
    KCH: "2026-11-18", CPH: "2026-11-18",
    QEH: "2026-11-20",
    UCH: "2026-11-23", TKO: "2026-11-23",
    KWH: "2026-11-24", OLM: "2026-11-24", HCH: "2026-11-24",
    PMH: "2026-11-25", CMC: "2026-11-25", YCH: "2026-11-25", NLT: "2026-11-25", KTH: "2026-11-25",
    PWH: "2026-11-26", NDH: "2026-11-26", AHN: "2026-11-26",
    TMH: "2026-11-27", POH: "2026-11-27", TSH: "2026-11-27",
    QMH: "2026-11-30", TWH: "2026-11-30", PYN: "2026-11-30", RH: "2026-11-30", TWE: "2026-11-30"
  };

  render();
  root.addEventListener("input", onInput);
  root.addEventListener("click", onClick);

  function onInput(e) {
    if (e.target.id === "day-connect") connect = e.target.value;
    if (e.target.id === "day-user") user = e.target.value;
    if (e.target.id === "day-date") localStorage.setItem(DAY_KEY, e.target.value);
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
    var range = e.target.getAttribute && e.target.getAttribute("data-day");
    if (range) {
      setDay(range === "yesterday" ? shift(-1) : new Date());
      run();
      return;
    }
    if (e.target.id === "day-stop") {
      stop();
      return;
    }
    if (e.target.id !== "day-run") return;
    run();
  }

  function shift(days) {
    var day = new Date();
    day.setDate(day.getDate() + days);
    return day;
  }

  function setDay(date) {
    var field = document.getElementById("day-date");
    field.value = datePart(date);
    localStorage.setItem(DAY_KEY, field.value);
  }

  function datePart(date) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate());
  }

  function storedIso(text) {
    var raw = String(text || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    var shown = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
    return shown ? shown[3] + "-" + shown[2] + "-" + shown[1] : "";
  }

  function render() {
    var saved = storedIso(localStorage.getItem(DAY_KEY) || "");
    root.innerHTML =
      '<div class="health-page">' +
      '<div class="dash-top"><h1>Day counts</h1><p class="src">One calendar day, every hospital. Drug charging counts rows whose fc_upd_dtm falls on that day. Case services count upd_dtm. The read runs when an index starts with that time, or with the hospital and then that time. Password is used for this check and is not stored. The database read does not write. Disconnect closes the session if a read is still running.</p></div>' +
      '<div class="reg-fields">' +
      '<label class="wide">Connection string<input id="day-connect" class="url" spellcheck="false" placeholder="host:port/service" autocomplete="off" value="' + escapeAttr(connect) + '"></label>' +
      '<label>Username<input id="day-user" spellcheck="false" autocomplete="off" value="' + escapeAttr(user) + '"></label>' +
      '<label>Password<input id="day-pass" type="password" autocomplete="off"></label>' +
      '<label>Day<input id="day-date" type="date" value="' + escapeAttr(saved) + '"></label>' +
      '<button type="button" data-day="yesterday">Yesterday</button>' +
      '<button type="button" data-day="today">Today</button>' +
      '<button type="button" id="day-run" class="primary">Connect and load</button>' +
      '<button type="button" id="day-stop" class="danger" disabled>Disconnect</button>' +
      '</div>' +
      '<p id="day-msg" class="need" role="status"></p>' +
      '<div id="day-out"></div>' +
      '</div>';
    document.getElementById("day-out").innerHTML = '<p class="muted">Enter the database login and press Connect and load. The count is that calendar day, from 00:00 until the next midnight.</p>';
    if (!saved) setDay(new Date());
  }

  function run() {
    if (running) return;
    connect = document.getElementById("day-connect").value;
    user = document.getElementById("day-user").value;
    var day = document.getElementById("day-date").value;
    localStorage.setItem(CONNECT_KEY, connect);
    localStorage.setItem(USER_KEY, user);
    localStorage.setItem(DAY_KEY, day);
    var pass = document.getElementById("day-pass").value;
    var problems = [];
    if (!connect.trim() || !user.trim() || !pass) problems.push("Connection string, username, and password are required.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) problems.push("Choose a day.");
    var msg = document.getElementById("day-msg");
    msg.textContent = problems.join(" ");
    if (problems.length) return;
    if (location.protocol === "file:") {
      msg.textContent = "Open http://127.0.0.1:8770/ after node regression-proxy.js. A file page cannot reach the database.";
      return;
    }
    running = true;
    document.getElementById("day-run").disabled = true;
    document.getElementById("day-stop").disabled = false;
    msg.textContent = "Reading. The session is read only.";
    stopCtrl = new AbortController();
    fetch("/day-count", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ connectString: connect.trim(), user: user.trim(), password: pass, day: day }),
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
      var btn = document.getElementById("day-run");
      var stopBtn = document.getElementById("day-stop");
      if (btn) btn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
    });
  }

  function stop() {
    if (stopCtrl) stopCtrl.abort();
    fetch("/day-count/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: "{}"
    }).catch(function () {});
  }

  function paint(data) {
    var rows = (data.rows || []).slice().sort(function (a, b) {
      var ac = a.case == null ? -1 : Number(a.case);
      var bc = b.case == null ? -1 : Number(b.case);
      if (bc !== ac) return bc - ac;
      return String(a.hospital || "").localeCompare(String(b.hospital || ""));
    });
    var charge = data.charge || {};
    var cases = data.case || {};
    var chargeTotal = 0;
    var caseTotal = 0;
    var body = rows.map(function (row, index) {
      if (row.charge != null) chargeTotal += Number(row.charge);
      if (row.case != null) caseTotal += Number(row.case);
      var dhp = dhpState(row.hospital);
      return "<tr" + (dhp.rolled ? ' class="mark-go"' : "") + "><td>#" + (index + 1) + "</td><td>" + escapeText(row.hospital) + "</td><td>" + dhp.text + "</td><td>" + cell(cases, row.case) + "</td><td>" + cell(charge, row.charge) + "</td></tr>";
    }).join("");
    var notes = [charge, cases].filter(function (item) { return item && !item.ran && item.reason; }).map(function (item) {
      return '<p class="need">' + escapeText(item.reason) + "</p>";
    }).join("");
    document.getElementById("day-out").innerHTML =
      '<p class="src">' + escapeText((data.day || "") + (data.now ? " · database " + data.now : "")) + "</p>" +
      notes +
      '<div class="health-cards dash-cards">' +
      card("Case services", cases.ran ? formatNum(caseTotal) : "—", cases.ran ? "rows that day" : "Not counted") +
      card("Drug charging", charge.ran ? formatNum(chargeTotal) : "—", charge.ran ? "rows that day" : "Not counted") +
      "</div>" +
      (body ? '<p class="src">DHP rollout is the planned date for that hospital. Green means the date is today or earlier. It is not read from the database.</p><div class="dash-table-wrap day-table-wrap"><table class="dash-table"><thead><tr><th>#</th><th>Hospital</th><th>DHP rollout</th><th>Case services</th><th>Drug charging</th></tr></thead><tbody>' + body + "</tbody></table></div>" : "") +
      '<section class="health-panel"><div class="panel-head"><h2>SQL</h2><button type="button" class="sql-toggle" aria-expanded="false">SQL</button></div><pre class="sql-block" hidden>' + escapeText((data.sql || []).join("\n\n")) + "</pre></section>";
  }

  function dhpState(hospital) {
    var code = String(hospital || "").trim().toUpperCase();
    var day = DHP_ROLLOUT[code];
    if (!day) return { text: "—", rolled: false };
    var today = datePart(new Date());
    var rolled = day <= today;
    var shown = day.slice(8, 10) + "/" + day.slice(5, 7) + "/" + day.slice(0, 4);
    return { text: rolled ? "Rolled out " + shown : shown, rolled: rolled };
  }

  function cell(spec, value) {
    if (!spec || !spec.ran) return "—";
    if (value == null) return "0";
    return escapeText(formatNum(value));
  }

  function card(k, v, s) {
    return '<article class="health-card"><div class="k">' + escapeText(k) + '</div><div class="v">' + escapeText(v) + '</div><div class="s">' + escapeText(s) + "</div></article>";
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
