(function () {
  var root = document.getElementById("view-scripts");
  if (!root) return;

  var items = [
    {
      title: "1. Magic word (PowerShell)",
      facts: [
        ["Schedule", "Not scheduled. Run it when the word changes."]
      ],
      command: "cd C:\\Users\\CCK585\\Desktop\\workspace\\fcs-system\\self-scripts\\magicword\npy .\\magicword.py"
    },
    {
      title: "2. System page (PowerShell)",
      facts: [
        ["Schedule", "Not scheduled."],
        ["Page", "http://127.0.0.1:8770/"]
      ],
      command: "cd C:\\Users\\CCK585\\Desktop\\workspace\\fcs-system\nnpm install\nnode regression-proxy.js"
    },
    {
      title: "3. Backup all EAR files from production (PowerShell)",
      facts: [
        ["Schedule", "Not scheduled."],
        ["Environment", "Production"]
      ],
      command: "cd C:\\Users\\CCK585\\Desktop\\Doc\\FCS\\fcs-deployment\n.\\backup-ear.ps1"
    },
    {
      title: "4. Backup SIT receipt PNG (PowerShell)",
      facts: [
        ["Schedule", "FCS pull war png, every hour while logged on"],
        ["Environment", "SIT, eaptst72a"],
        ["Output", "D:\\FCS\\backup_sit_server_receipt"],
        ["Log", "D:\\FCS\\backup_sit_server_receipt\\pull.log"]
      ],
      command: "cd C:\\Users\\CCK585\\Desktop\\workspace\\fcs-system\npy -3 self-scripts\\pull-server\\pull-sit-receipt-png\\pull-war-png.py"
    },
    {
      title: "5. Pull log (PowerShell)",
      facts: [
        ["Schedule", "FCS pull server log, weekdays 17:00 while the computer is on. It does not wake the PC. If the PC is off at 17:00, it runs once when the computer is next on. You need to be logged on."],
        ["Environment", "SIT eaptst72a, UAT eaptst72e, production 76a, 76b, 78a, and 78b"],
        ["What it copies", "The current log plus rotated files from the last 14 days, including .gz. A file already saved at the same size is skipped."],
        ["Output", "D:\\FCS\\remote-log\\pull-log\\sit, uat, and prod\\76a, 76b, 78a, 78b. Each has fcs, kiosk, and payha."],
        ["Log", "self-scripts\\pull-server\\pull-log\\pull-sit.log, pull-uat.log, and pull-prod.log"],
        ["Login", "A bad password stops that environment and is not tried again. A failed connection is not tried again on that server."]
      ],
      command: "cd C:\\Users\\CCK585\\Desktop\\workspace\\fcs-system\npy -3 self-scripts\\pull-server\\pull-log\\pull-log.py sit\npy -3 self-scripts\\pull-server\\pull-log\\pull-log.py uat\npy -3 self-scripts\\pull-server\\pull-log\\pull-log.py prod\npy -3 self-scripts\\pull-server\\pull-log\\pull-log.py prod --primary 78\npy -3 self-scripts\\pull-server\\pull-log\\pull-log.py prod --all"
    },
    {
      title: "6. Pull database code (PowerShell)",
      facts: [
        ["Schedule", "FCS pull db code, every Thursday 17:00 while logged on"],
        ["Environment", "SIT, then UAT, then production. The first command with no file name is SIT."],
        ["Output", "self-scripts\\pull-db-code\\out_sit, out_uat, and out_prod. Each run adds a new datetime folder."],
        ["Log", "self-scripts\\pull-db-code\\pull-db-code.log"]
      ],
      command: "cd C:\\Users\\CCK585\\Desktop\\workspace\\fcs-system\nnode self-scripts\\pull-db-code\\pull-db-code.js\nnode self-scripts\\pull-db-code\\pull-db-code.js db.uat.json\nnode self-scripts\\pull-db-code\\pull-db-code.js db.prod.json"
    },
    {
      title: "7. Password encryption for day-end",
      facts: [
        ["Schedule", "Not scheduled."]
      ],
      command: "cd \\\\dc7shdns04b.corp.ha.org.hk\\HA5_PBRC\\PBRC_Password_Encryption\\Console_Jar\njava -jar .\\PBRCEncryption.jar"
    }
  ];

  root.innerHTML =
    '<div class="health-page self-script-page">' +
    '<div class="dash-top"><h1>Self script</h1>' +
    '<p class="src">PowerShell commands for the scripts in self-scripts, plus the EAR backup and the day-end password tool. Copy takes the command block.</p></div>' +
    items.map(card).join("") +
    "</div>";

  root.addEventListener("click", function (event) {
    var button = event.target.closest("[data-copy]");
    if (!button) return;
    var text = items[Number(button.getAttribute("data-copy"))].command;
    var done = function () {
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = "Copy"; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(text); done(); });
    } else {
      fallback(text);
      done();
    }
  });

  function card(item, index) {
    var facts = item.facts.map(function (fact) {
      return "<div><strong>" + esc(fact[0]) + ".</strong> " + esc(fact[1]) + "</div>";
    }).join("");
    return '<article class="self-card"><div class="head"><h2>' + esc(item.title) + '</h2>' +
      '<button type="button" data-copy="' + index + '">Copy</button></div>' +
      '<div class="self-meta">' + facts + "</div>" +
      "<pre>" + esc(item.command) + "</pre></article>";
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function fallback(text) {
    var area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
})();
