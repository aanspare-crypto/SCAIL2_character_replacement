@echo off
cd /d "%~dp0"
echo Starting the Blackdamp LAN server...
node server.js
if errorlevel 1 echo.
if errorlevel 1 echo Could not start. Is Node.js installed? Get it from https://nodejs.org
pause
