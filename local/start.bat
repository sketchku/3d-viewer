@echo off
echo ========================================
echo   3D File Viewer - Local Server
echo ========================================
echo.
echo Starting server at http://localhost:8080
echo Press Ctrl+C to stop.
echo.

cd /d "%~dp0"

where python >nul 2>&1
if %errorlevel% equ 0 (
    python serve.py 8080
    goto :end
)

where py >nul 2>&1
if %errorlevel% equ 0 (
    py serve.py 8080
    goto :end
)

echo Python is not installed. Please install Python 3.
pause

:end