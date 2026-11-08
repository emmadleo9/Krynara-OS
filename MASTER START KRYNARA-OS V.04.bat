@echo off
setlocal
title Krynara-OS MASTER START v4.0.1.16
cd /d "%~dp0"

echo.
echo  =============================================================
echo   Krynara-OS MASTER START v4.0.1.16
echo   Gateway (2785) + Console (5173) + WhatsApp API routes
echo  =============================================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-KRYNARA.ps1"
set "START_EXIT=%ERRORLEVEL%"

if "%START_EXIT%"=="0" (
    echo.
    echo [Krynara-OS] Startup complete.
    echo [Krynara-OS] Console: http://localhost:5173
    echo [Krynara-OS] Gateway: http://127.0.0.1:2785
) else (
    echo.
    echo [Krynara-OS] Startup stopped with exit code %START_EXIT%.
    pause
)

exit /b %START_EXIT%
