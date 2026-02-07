@echo off
REM Nano Banana Pro - Windows Start Script
REM Double-click this file to start the app

cd /d "%~dp0"
echo Starting Nano Banana Pro...
echo.

set PORT=4648

echo Server will run at http://localhost:%PORT%
echo Press Ctrl+C to stop
echo.
start "" http://localhost:%PORT%
npx -y serve -l %PORT%
