@echo off
title Ajan Merkezi
set "ROOT=%~dp0"
set "URL=http://127.0.0.1:8765"
set "PYW=%ROOT%ajan-merkezi\.venv\Scripts\pythonw.exe"

rem Sunucu calisiyor mu ve kod guncel mi? (0 = evet, 1 = calismiyor, 2 = eski surum calisiyor)
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%araclar\sunucu-kontrol.ps1"
if errorlevel 2 goto stale
if errorlevel 1 goto start
goto open

:stale
echo Eski surum calisiyor, yeniden baslatiliyor...
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -Method Post '%URL%/api/shutdown' -TimeoutSec 3 | Out-Null}catch{}; Start-Sleep -Seconds 2"

:start
echo Ajan Merkezi baslatiliyor, lutfen bekleyin...
start "" "%PYW%" "%ROOT%ajan-merkezi\server.py"
powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest -UseBasicParsing '%URL%/api/status' -TimeoutSec 2 | Out-Null; exit 0}catch{Start-Sleep -Milliseconds 700}}; exit 1"
if errorlevel 1 goto fail

:open
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" --app=%URL% --window-size=1480,920
) else (
  start "" %URL%
)
exit /b 0

:fail
echo Sunucu baslatilamadi. Ayrintilar: ajan-merkezi\panel.log
pause
exit /b 1
