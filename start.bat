@echo off
REM Nano Banana Pro - Windows Start Script
REM Double-click this file to start the app

cd /d "%~dp0"
echo Starting Nano Banana Pro...
echo.
echo Server will run at http://localhost:3000
echo Press Ctrl+C to stop
echo.
start "" http://localhost:3000
npx -y serve -l 3000
