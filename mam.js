(function () {
  var root = document.getElementById("view-mam");
  if (!root) return;

  root.innerHTML =
    '<div class="charge-read">' +
    "<h2>MAM login</h2>" +
    "<p>Medication Amendment Module is in the Phase 1 frontend, <span class=\"mono\">FC-BILLING_FCS_MAIN_APP\\SOURCE_CODE\\eFCS_revamp</span>. The logon form is <span class=\"mono\">public_html/login/mlogin.jsp</span>. Amend Chargeable Unit is <span class=\"mono\">public_html/mam/amendChargeableUnit.jsp</span>.</p>" +
    "<p>The menu is MAM only when <span class=\"mono\">hosp_station_mapping.system</span> for that workstation and hospital is <span class=\"mono\">MAM</span>. Opening the MAM form sets session <span class=\"mono\">isMAM</span>. That flag sends a failed login back to the MAM form. It does not choose the menu.</p>" +

    "<h2>Four steps</h2>" +
    '<ol class="steps">' +
    "<li><span class=\"mono\">mlogin_opener.jsp</span> does not show the form. On load it calls <span class=\"mono\">window.open</span> to <span class=\"mono\">mlogin.jsp</span> and then closes itself. A current browser blocks that popup, so the page says it cannot open the login screen. If the FCS cookie was written in the last 2 seconds, it alerts that the system is already opened and closes.</li>" +
    "<li><span class=\"mono\">mlogin.jsp</span> is the logon form in the current tab. <span class=\"mono\">mlogin_initial.jsp</span> sets session <span class=\"mono\">isMAM</span>. Hospital, workstation, and location are hidden fields. User ID is the visible field. Password is typed on the form.</li>" +
    "<li>Submit uses login command <span class=\"mono\">o</span>. <span class=\"mono\">proc_web_s_host_registered_ma7</span> reads <span class=\"mono\">hosp_station_mapping</span> by workstation (<span class=\"mono\">host_name</span>) and hospital. The row must be <span class=\"mono\">approval = 'Y'</span>, and <span class=\"mono\">epay_vendor_name</span> must match <span class=\"mono\">fc_epayment_info</span>. <span class=\"mono\">system</span> is returned onto the session.</li>" +
    "<li><span class=\"mono\">menu_content.jsp</span> opens Amend Chargeable Unit when <span class=\"mono\">system</span> is <span class=\"mono\">MAM</span>. Any other system shows the normal FCS menu, even if the form was the MAM form.</li>" +
    "</ol>" +

    "<h2>URL parameters</h2>" +
    "<p>The opener copies <span class=\"mono\">hospital_cde</span>, <span class=\"mono\">user_id</span>, <span class=\"mono\">workstation_id</span>, and <span class=\"mono\">location_id</span> onto <span class=\"mono\">mlogin.jsp</span>. A missing value is forwarded as a blank string. Blank is not SQL NULL, so the procedure still applies the hospital filter.</p>" +
    '<table class="means-map"><thead><tr><th>Parameter</th><th>Value</th><th>What happens</th></tr></thead><tbody>' +
    row("Page", "mlogin_opener.jsp", "Popup launcher only. The first URL stops here when the popup is blocked or the cookie is newer than 2 seconds.") +
    row("Page", "mlogin.jsp", "Logon form in this tab. This is the second URL.") +
    row("hospital_cde", "omitted or blank", "Lookup compares hospital to an empty string. The VH row does not match. Login says the PC is not registered.") +
    row("hospital_cde", "VH", "Matches hospital_cde VH. This is the second URL.") +
    row("hospital_cde", "another code", "Matches only an approved row for that hospital and the same workstation.") +
    row("user_id", "FCSUAT1", "Fills the User ID box. Both URLs do this. It does not choose MAM or FCS. Password is still required.") +
    row("workstation_id", "PBRCWC2", "Looks up host_name PBRCWC2. That PC's system is used. A normal PBRC workstation does not open the MAM menu. This is the first URL.") +
    row("workstation_id", "MAM", "Looks up host_name MAM. system MAM opens Amend Chargeable Unit. This is the second URL.") +
    row("workstation_id", "blank", "Login replaces a blank workstation with the caller PC name, then looks that name up.") +
    row("location_id", "omitted, blank, or any value", "Stored on the session and passed on to SAM. The workstation lookup and the MAM menu do not read it. Both URLs omit it.") +
    "</tbody></table>" +

    "<h2>Select the station</h2>" +
    "<p>Read <span class=\"mono\">hosp_station_mapping</span> for the two workstation names. <span class=\"mono\">system</span> is the module. <span class=\"mono\">approval</span> must be Y before login accepts the row.</p>" +
    sql(
      "SELECT hospital_cde,\n" +
      "       host_name,\n" +
      "       station_id,\n" +
      "       system,\n" +
      "       approval,\n" +
      "       epay_vendor_name,\n" +
      "       is_ldap_login,\n" +
      "       remarks,\n" +
      "       last_upd_by,\n" +
      "       last_upd_dtm\n" +
      "  FROM hosp_station_mapping\n" +
      " WHERE UPPER(TRIM(host_name)) IN ('MAM', 'PBRCWC2')\n" +
      " ORDER BY hospital_cde, host_name, station_id;"
    ) +
    "<p>This is the same filter as <span class=\"mono\">proc_web_s_host_registered_ma7</span>. No row means login says the PC is not registered. The unique key is hospital, host name, and station id.</p>" +
    sql(
      "SELECT m.hospital_cde,\n" +
      "       m.host_name,\n" +
      "       m.station_id,\n" +
      "       m.system,\n" +
      "       m.approval,\n" +
      "       m.epay_vendor_name\n" +
      "  FROM hosp_station_mapping m\n" +
      "  JOIN fc_epayment_info i\n" +
      "    ON UPPER(TRIM(m.epay_vendor_name)) = UPPER(TRIM(i.epay_vendor_name))\n" +
      " WHERE UPPER(TRIM(m.host_name)) = 'MAM'\n" +
      "   AND UPPER(TRIM(m.hospital_cde)) = 'VH'\n" +
      "   AND m.approval = 'Y';"
    ) +

    "<h2>Register a station</h2>" +
    "<p>The logon screen registration calls <span class=\"mono\">proc_web_register_pc</span>. Java always passes system <span class=\"mono\">PBRC</span>. The insert sets <span class=\"mono\">approval</span> to N. That row cannot log in, and it is not MAM. The SIT pull <span class=\"mono\">20261111_142604</span> marks <span class=\"mono\">proc_web_register_pc</span> INVALID, so confirm it compiles before calling it. These statements write. This page does not run them.</p>" +
    sql(
      "-- Screen path: LoginHandler.regWorkStation\n" +
      "-- system is hardcoded 'PBRC' in InsertStationIdHelperImpl.\n" +
      "-- The procedure inserts approval 'N'.\n" +
      "BEGIN\n" +
      "  proc_web_register_pc(\n" +
      "    v_ret_cde      => :ret_cde,\n" +
      "    v_ret_msg      => :ret_msg,\n" +
      "    v_hospital_cde => 'VH',\n" +
      "    v_station_id   => :station_id,\n" +
      "    iv_host_name   => 'MAM',\n" +
      "    v_system       => 'PBRC',\n" +
      "    v_location_desc => NULL,\n" +
      "    v_user_name    => NULL,\n" +
      "    v_contact_info => NULL,\n" +
      "    v_last_upd_by  => 'FCSUAT1',\n" +
      "    v_last_upd_dtm => SYSTIMESTAMP\n" +
      "  );\n" +
      "END;"
    ) +
    "<p>After the row exists, set the module, approve it, and give it a vendor that already exists on <span class=\"mono\">fc_epayment_info</span>. Copy <span class=\"mono\">epay_vendor_name</span> from a station at the same hospital that already logs in.</p>" +
    sql(
      "-- Writes. Copy epay_vendor_name from a working station at this hospital.\n" +
      "UPDATE hosp_station_mapping\n" +
      "   SET system = 'MAM',\n" +
      "       approval = 'Y',\n" +
      "       epay_vendor_name = :epay_vendor_name,\n" +
      "       last_upd_by = :user_id,\n" +
      "       last_upd_dtm = SYSTIMESTAMP\n" +
      " WHERE hospital_cde = :hospital_cde\n" +
      "   AND UPPER(TRIM(host_name)) = UPPER(TRIM(:workstation_id));"
    ) +
    "</div>";

  function row(param, value, effect) {
    return "<tr><td>" + esc(param) + "</td><td>" + esc(value) + "</td><td>" + esc(effect) + "</td></tr>";
  }

  function sql(text) {
    return '<pre class="sql">' + esc(text) + "</pre>";
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
