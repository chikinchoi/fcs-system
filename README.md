# FCS system

## Start the page

1. Open a terminal in this folder:

   `C:\Users\CCK585\Desktop\workspace\fcs-system`

2. Check that Node.js is installed:

   `node -v`

3. The first time on this machine, install the Oracle driver. Skip this step when `node_modules\oracledb` is already there. The Drug charge page does not call the database. MOE and receipts, day count, and DHP canary do, and they need this driver.

   `npm install`

   Outbound npm calls on this machine use the proxy already set in the user npmrc. Do not put that proxy URL on the command line.

4. Start the local page runner:

   `node regression-proxy.js`

5. Wait until the terminal prints:

   `Regression runner at http://127.0.0.1:8770/`

6. Open that address in the browser:

   `http://127.0.0.1:8770/`

7. Use the sidebar. **Drug charge** is the pay-flag and charge-rate page. Leave the terminal open while you use the page. The runner reads the HTML, JavaScript, and CSS from this folder on each request.

8. Stop the runner with Ctrl+C in that terminal.

If step 4 says the port is already in use, an older runner is still on port 8770. Stop that terminal, or end the process that is listening on 8770, then run `node regression-proxy.js` again.

Opening `index.html` as a file does not reach the runner. Database pages and the regression calls need `http://127.0.0.1:8770/`.

## SDC data flow

The first module is the SDC path: MOE charge header and detail, the insert triggers, then case service, drug charging, the PayHA queue, and the receipt lookup.

1. Set hospital, case number, and one or more MOE orders. **Example** fills a sample set.
2. Click a step. The panel explains that step and shows the SQL with those values filled in.
3. **Copy** takes that statement. **Copy SDC SQL** takes every SDC statement whose fields are filled.
4. A green dot means the SQL is ready. An amber dot means a header field is still missing.

Profile, log, and exception SQL use the MOE order as text. Drug charging, PayHA, and the joins use it as a number. Case service and `fc_sdc_txn_index` use hospital and case number, not the MOE order.

The OPAS interface statements are separate. They are not filtered by the MOE order.

Receipt type and Pay flag are the other two sidebar pages. Each row is one patient path, from the OPAS flag and the amount to the receipt. The buttons along the top only dim the paths that do not match. Amounts 80 and 40 are samples. The SQL copy control is the copy icon.

Arrow keys move along the flow when the cursor is outside the fields. Hospital, case, MOE order, and the selected step are kept in this browser.

## Production health

MOE and receipts reads the database from this machine and draws the charts. It does not write, and it does not take SQL from the page.

1. In this folder run `npm install` once, then `node regression-proxy.js`.
2. Open `http://127.0.0.1:8770/` and choose **MOE and receipts**.
3. Enter the connection string (`host:1521/service`), username, and password. The password stays in the page. It is not saved in this browser.
4. Enter one hospital. A blank day means today.

The MOE chart is `sysmon_moe_rep`: one row per hospital, the last charge header. The seat chart is `fc_user_ws_list`: the last receipt save for each user and workstation at that hospital. The lines are one hospital and one day: med header arrival, med detail create time, drug charging, case services, SFI charging, every receipt type including zeros, and detail exceptions. Each line runs only when a valid index can bound that day by the time column. The detail log is not counted, because the Oracle detail trigger does not insert it. Each read stops after 8 seconds. One check runs at a time. The session is read only.

## DHP canary

DHP canary is the check for a hospital already switched to `USE_DHP_NEW_ENDPOINT`. It uses the same connection string, username, and password as MOE and receipts. The password is not saved.

The page reads `FC_HOSPITAL_CODES` and then `WS_TRANSACTION_LOG`. A new-endpoint call is a log row whose request parameters contain `_logSource`. The comparison uses the fields the payment code stores. The Code column is Same, Handled, or Differs. Handled means the raw payloads differ and the mapping already accounts for that, such as `opasUnit` stored as `subSpecialty`, `opasPayCode` stored as `payCode`, `unicodeInt` stored as `CCCode`, and a blank waiver date stored as `1900-01-01`.

The old value is a SOAP log for the same appointment sequence, case number, or patient key. The page walks the newest log rows, through the request-time index, and stops after 4800 rows so each read stays inside 8 seconds. Production does not call both endpoints for one trigger, so a call with no earlier SOAP row in that set has no old value. The log is read only when `REQUEST_DTM` leads an index, and the range cannot be longer than 7 days.

## Regression

FCS Generic, PayHA, Kiosk, and Frontend are separate sidebar pages. Checked calls are reads. Save and update calls are listed and this page does not send them. The environment list comes from the Web Services note. The address stays editable. Each API shows a curl command. The browser cannot call those hosts itself, so run `node regression-proxy.js` in this folder and open `http://127.0.0.1:8770/`. Run request turns red when the address is a production host. A green Works mark means the service answered, and the time beside it is the last run.
