@echo off
cd /d C:\Users\CCK585\Desktop\workspace\fcs-system
set "PY=C:\Users\CCK585\AppData\Local\Programs\Python\Python313\python.exe"
set "SCRIPT=self-scripts\pull-server\pull-log\pull-log.py"
set "DIR=%~dp0"
>>"%DIR%pull-sit.log" echo %DATE% %TIME% start
"%PY%" %SCRIPT% sit >>"%DIR%pull-sit.log" 2>&1
>>"%DIR%pull-sit.log" echo %DATE% %TIME% exit %ERRORLEVEL%
>>"%DIR%pull-uat.log" echo %DATE% %TIME% start
"%PY%" %SCRIPT% uat >>"%DIR%pull-uat.log" 2>&1
>>"%DIR%pull-uat.log" echo %DATE% %TIME% exit %ERRORLEVEL%
>>"%DIR%pull-prod.log" echo %DATE% %TIME% start
"%PY%" %SCRIPT% prod --all >>"%DIR%pull-prod.log" 2>&1
>>"%DIR%pull-prod.log" echo %DATE% %TIME% exit %ERRORLEVEL%
