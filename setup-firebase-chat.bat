@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0setup-firebase-chat.ps1"
pause