@echo off
REM Nano Banana Pro - Windows Start Script
REM Double-click this file to start the app

cd /d "%~dp0"
echo Starting Nano Banana Pro...
echo.

REM Find a free port starting from 3000
for /f "tokens=*" %%p in ('powershell -NoProfile -Command "$ports = 3000..3100; foreach ($p in $ports) { $used = netstat -an | Select-String \":$p \"; if (-not $used) { Write-Output $p; break } }"') do set PORT=%%p

if not defined PORT set PORT=3000

echo Server will run at http://localhost:%PORT%
echo Press Ctrl+C to stop
echo.
start "" http://localhost:%PORT%
npx -y serve -l %PORT%
