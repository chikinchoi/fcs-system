(function () {
  var root = document.getElementById("view-dayend");
  if (!root) return;

  var jobs = [
    {
      id: "vh",
      name: "VH",
      time: "18:00",
      cron: "00 18 * * *",
      db: "FCS_SERVICE_1F1",
      envFile: "environment.FCSORADB",
      state: "Stops before the database. The list has only TMH tagged P-TMH, and this job looks for P-VH.",
      steps: [
        { script: "drug_interface_vh.sh", log: "drug_interface_vh.YYYYMMDD.log" },
        { script: "pbrc_drugintf_new.sh VH", log: "pbrc_drugintf_new.YYYYMMDD.log", list: "fcs.server_new.list, tag P-VH" }
      ],
      branches: [
        { title: "List row is ORA", script: "fcs_drugintf_new_ora.sh", log: "drugintf_ora.{hospital}.YYYYMMDD.log", db: "FCS_SERVICE_1F1" },
        { title: "List row is another server type", script: "fcs_drugintf_new.sh", log: "Log name is not in the 20261125 pull" }
      ],
      extra: "pbrc_drugintf_new_pg.sh is on the server and is not in this crontab. It would write the same log as pbrc_drugintf_new.sh."
    },
    {
      id: "aat",
      name: "AAT",
      time: "18:15",
      cron: "15 18 * * *",
      db: "PAYHATS2",
      envFile: "environment.PAYHATS2",
      state: "Opens no Oracle database. The script calls QEH, then PMH. Both rows are SD6. PWH and NLT are in the list and commented out in the script.",
      steps: [
        { script: "drug_interface_aat.sh", log: "drug_interface_aat.YYYYMMDD.log" },
        { script: "pbrc_drugintf_new_aat.sh QEH, then PMH", log: "pbrc_drugintf_new_aat.YYYYMMDD.log", list: "fcs.server_new_aat.list, tags P-QEH and P-PMH" }
      ],
      branches: [
        { title: "List row is ORA", script: "fcs_drugintf_new_ora_aat.sh", log: "drugintf_ora_aat.{hospital}.YYYYMMDD.log", db: "PAYHATS2" },
        { title: "List row is another server type", live: true, script: "fcs_drugintf_new_aat.sh", log: "Log name is not in the 20261125 pull" }
      ]
    },
    {
      id: "sit",
      name: "SIT",
      time: "18:20",
      cron: "20 18 * * *",
      db: "CPBR0P1",
      envFile: "environment.CPBR0P1",
      state: "Opens CPBR0P1. The list row for VH is ORA. QMH is also in the list. The script calls only VH.",
      steps: [
        { script: "drug_interface_sit.sh", log: "drug_interface_sit.YYYYMMDD.log" },
        { script: "pbrc_drugintf_new_sit.sh VH", log: "pbrc_drugintf_new_sit.YYYYMMDD.log", list: "fcs.server_new_sit.list, tag P-VH" }
      ],
      branches: [
        { title: "List row is ORA", live: true, script: "fcs_drugintf_new_ora_sit.sh", log: "drugintf_ora_sit.VH.YYYYMMDD.log", db: "CPBR0P1" },
        { title: "List row is another server type", script: "fcs_drugintf_new_sit.sh", log: "Log name is not in the 20261125 pull" }
      ],
      extra: "The parent log prints Run Oracle DB for AAT. That text was left from the AAT copy. The command it runs is fcs_drugintf_new_ora_sit.sh."
    }
  ];

  root.innerHTML =
    '<div class="health-page dayend-page">' +
    '<div class="dash-top"><h1>Day-end non production</h1>' +
    '<p class="src">As of 20261125, on cdcdev04. One section per environment. Logs are under /appl/pbrc/home/pbrcadm/drugintf/log/. YYYYMMDD is the run date. {hospital} is the FCS hospital from the list.</p></div>' +
    '<nav class="dayend-jump" aria-label="Environments">' +
    jobs.map(function (job) {
      return '<a href="#dayend-' + job.id + '">' + job.name + ' ' + job.time + '</a>';
    }).join("") +
    '</nav>' +
    jobs.map(session).join("") +
    '</div>';

  root.addEventListener("click", function (e) {
    var link = e.target.closest ? e.target.closest("a[href^='#dayend-']") : null;
    if (!link) return;
    var section = document.getElementById(link.getAttribute("href").slice(1));
    if (!section) return;
    e.preventDefault();
    section.scrollIntoView({ block: "start" });
  });

  function session(job) {
    return '<section class="dayend-session" id="dayend-' + job.id + '">' +
      '<header><h2>' + job.name + '</h2><p class="when">' + job.time + '</p></header>' +
      '<p class="dayend-db"><span>Database</span> ' + job.db + ' <span class="from">' + job.envFile + '</span></p>' +
      '<p class="dayend-state">' + job.state + '</p>' +
      '<p class="dayend-cron">Crontab ' + job.cron + '</p>' +
      '<ol class="dayend-steps">' + job.steps.map(step).join("") + branchStep(job) + '</ol>' +
      (job.extra ? '<p class="dayend-extra">' + job.extra + '</p>' : '') +
      '</section>';
  }

  function step(item, index) {
    return '<li><span class="n">' + (index + 1) + '</span><div>' +
      row("Script", item.script) +
      row("Log", item.log) +
      (item.list ? row("List", item.list) : '') +
      '</div></li>';
  }

  function branchStep(job) {
    var blocks = job.branches.map(function (branch) {
      return '<div class="dayend-branch' + (branch.live ? ' live' : '') + '">' +
        '<p class="branch-title">' + branch.title + (branch.live ? ' · 20261125 path' : '') + '</p>' +
        row("Script", branch.script) +
        row("Log", branch.log) +
        (branch.db ? row("Database", branch.db) : '') +
        '</div>';
    }).join("");
    return '<li><span class="n">' + (job.steps.length + 1) + '</span><div>' + blocks + '</div></li>';
  }

  function row(label, value) {
    return '<p class="dayend-row"><span class="k">' + label + '</span><span class="v">' + value + '</span></p>';
  }
})();
