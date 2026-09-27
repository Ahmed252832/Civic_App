@echo off
cd /d "%~dp0"
call npm run web:open
if errorlevel 1 pause
