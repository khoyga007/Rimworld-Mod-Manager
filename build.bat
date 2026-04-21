@echo off
setlocal
cd /d "%~dp0"
echo ===============================================
echo   RimWorld Mod Manager - PRODUCTION BUILD
echo   This compiles a release .exe (takes a while)
echo ===============================================
echo.

if not exist "node_modules" (
    echo [setup] Installing npm dependencies...
    call npm install
    if errorlevel 1 goto :error
)

call npm run tauri build
if errorlevel 1 goto :error

echo.
echo ===============================================
echo   Build complete.
echo   Installer: src-tauri\target\release\bundle\
echo   Raw exe:   src-tauri\target\release\rimworldmodmanager.exe
echo ===============================================
echo.
explorer "src-tauri\target\release\bundle"
pause
goto :eof

:error
echo.
echo [!] Build failed with errorlevel %errorlevel%
pause
exit /b %errorlevel%
