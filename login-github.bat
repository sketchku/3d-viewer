@echo off
title GitHub Login
echo ========================================
echo   GitHub CLI Login
echo ========================================
echo.
echo 1. Browser will open to https://github.com/login/device
echo 2. Copy the one-time code shown below
echo 3. Paste it on the page and click Authorize
echo.
start https://github.com/login/device
gh auth login -h github.com -p https -w -s repo,workflow --skip-ssh-key
if %errorlevel% neq 0 (
    echo.
    echo Login failed or cancelled.
    pause
    exit /b 1
)
echo.
echo Login successful!
echo Next: run publish.ps1
pause