@echo off
setlocal
cd /d "%~dp0"
echo ===============================================
echo   RimWorld Mod Manager - DEV MODE
echo   Hot reload enabled. Ctrl+C to stop.
echo ===============================================
echo.

if not exist "node_modules" (
    echo [setup] Installing npm dependencies...
    call npm install
    if errorlevel 1 goto :error
)

call npm run tauri dev
if errorlevel 1 goto :error
goto :eof

:error
echo.
echo [!] Command failed with errorlevel %errorlevel%
pause
exit /b %errorlevel%
