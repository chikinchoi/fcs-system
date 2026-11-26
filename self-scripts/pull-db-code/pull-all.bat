@echo off
cd /d C:\Users\CCK585\Desktop\workspace\fcs-system
set "NODE=C:\Program Files\nodejs\node.exe"
set "LOG=%~dp0pull-db-code.log"
>>"%LOG%" echo %DATE% %TIME% start sit
"%NODE%" self-scripts\pull-db-code\pull-db-code.js >>"%LOG%" 2>&1
>>"%LOG%" echo %DATE% %TIME% exit sit %ERRORLEVEL%
>>"%LOG%" echo %DATE% %TIME% start uat
"%NODE%" self-scripts\pull-db-code\pull-db-code.js db.uat.json >>"%LOG%" 2>&1
>>"%LOG%" echo %DATE% %TIME% exit uat %ERRORLEVEL%
>>"%LOG%" echo %DATE% %TIME% start prod
"%NODE%" self-scripts\pull-db-code\pull-db-code.js db.prod.json >>"%LOG%" 2>&1
>>"%LOG%" echo %DATE% %TIME% exit prod %ERRORLEVEL%
