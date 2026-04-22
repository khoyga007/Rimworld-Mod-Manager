@echo off
setlocal
title RimWorld Mod Manager - Quick Start Helper

echo =======================================================
echo    RimWorld Mod Manager - Trinh Khoi Chay Nhanh
echo =======================================================
echo.

:: 1. Kiem tra Node.js
echo [+] Dang kiem tra Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] LOI: Khong tim thay Node.js tren may ban.
    echo [!] Vui long tai va cai dat Node.js tai: https://nodejs.org/
    start https://nodejs.org/
    pause
    exit /b
)
echo [OK] Node.js da san sang.

:: 2. Kiem tra Rust (Can thiet de chay dev mode)
echo [+] Dang kiem tra Rust (Cargo)...
cargo --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] LOI: Khong tim thay Rust (Cargo).
    echo [!] De chay ban dev, ban can cai dat Rust tai: https://rustup.rs/
    echo [!] Neu ban chi muon dung app, hay tai ban Release (.exe) tren GitHub.
    start https://rustup.rs/
    pause
    exit /b
)
echo [OK] Rust da san sang.

:: 3. Cai dat cac thu vien (Dependencies)
echo [+] Dang kiem tra va cai dat cac thu vien (npm install)...
echo [!] Viec nay chi thuc hien trong lan dau hoac khi co thay doi.
call npm install
if %errorlevel% neq 0 (
    echo [!] LOI: Co loi khi chay 'npm install'. Vui long kiem tra ket noi mang.
    pause
    exit /b
)
echo [OK] Thu vien da duoc cai dat.

:: 4. Khoi chay App o che do Dev
echo.
echo =======================================================
echo    DANG KHOI CHAY UNG DUNG... (Vui long doi mot chut)
echo =======================================================
echo.
call npm run tauri dev

pause
