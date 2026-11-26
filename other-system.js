(function () {
  var root = document.getElementById("view-other");
  if (!root) return;

  var items = [
    {
      title: "CMS (SIT)",
      rows: [
        ["Link", "Not saved in memo.md or Chrome bookmarks."],
        ["Note", "memo.md under CMS only records workstation HAOPBRC00006, the path IxRequest, new request, Dis, and a question about needing a CCP agent. Those lines are not a SIT URL."]
      ]
    },
    {
      title: "OPAS (SIT)",
      rows: [
        ["Link", "https://paseap-corp-opas-sit.server.ha.org.hk:13234/pas-login-app/sam/opasLogin.jsp?inst_cd=VH&env=nonprd&forwarder=OPAS-12C-HTTPS&host=UATOPAS001"],
        ["Login", "AWUSER"],
        ["Password", "Abcd1234"]
      ]
    },
    {
      title: "IPAS (SIT)",
      rows: [
        ["Link", "https://paseap-corp-ipas-sit.server.ha.org.hk:13233/pas-login-app/sam/ipasLogin.jsp?inst_cd=VH&env=nonprd&forwarder=IPAS-12C-HTTPS&host=HAHIPAS01007"],
        ["Login", "ha5user"],
        ["Password", "Ha5user!"]
      ]
    },
    {
      title: "PBRC (SIT)",
      rows: [
        ["Link", "Not saved as a SIT URL in memo.md or Chrome bookmarks."],
        ["Note", "memo.md records a PBRC launcher used for preprod, not SIT. Folder C:\\PBRCpowerLauncher. Example launch URL https://wcdcpbrcmdt708:12170/pbrc/launch.json. Add https://wcdcpbrcmdt708:12170/pbrc in PBRC Launcher. Example id ha5dc, password power, for preprod."]
      ]
    }
  ];

  root.innerHTML =
    '<div class="health-page self-script-page">' +
    '<div class="dash-top"><h1>Other system</h1>' +
    '<p class="src">SIT logins for systems outside FCS. OPAS and IPAS are the links saved in memo.md and the Chrome bookmarks. CMS and PBRC have no saved SIT link.</p></div>' +
    items.map(card).join("") +
    "</div>";

  function card(item) {
    var rows = item.rows.map(function (row) {
      var value = row[0] === "Link" && row[1].indexOf("http") === 0
        ? '<a href="' + esc(row[1]) + '" target="_blank" rel="noopener">' + esc(row[1]) + "</a>"
        : esc(row[1]);
      return '<div class="dayend-row"><span class="k">' + esc(row[0]) + '</span><span class="v">' + value + "</span></div>";
    }).join("");
    return '<article class="self-card"><h2>' + esc(item.title) + "</h2>" + rows + "</article>";
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
