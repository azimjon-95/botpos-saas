@echo off
echo ========================================
echo   BOT·POS — Lokal muhit ishga tushishi
echo ========================================

echo.
echo [1/3] NGINX config ni C:\nginx\conf\ ga ko'chirish...
if not exist "C:\nginx\conf\" (
    echo XATO: C:\nginx papkasi topilmadi!
    echo nginx.org dan yuklab C:\nginx ga o'rnating
    pause
    exit /b 1
)
copy /Y "%~dp0nginx.conf" "C:\nginx\conf\nginx.conf" > nul
echo OK

echo.
echo [2/3] NGINX config tekshirilmoqda...
cd /d C:\nginx
nginx.exe -t
if errorlevel 1 (
    echo XATO: Config xatosi bor!
    pause
    exit /b 1
)

echo.
echo [3/3] NGINX ishga tushirilmoqda...
nginx.exe -s stop 2>nul
timeout /t 1 /nobreak > nul
nginx.exe
echo OK

echo.
echo ========================================
echo   TAYYOR! Quyidagilarni oching:
echo   Admin panel : http://localhost:8080
echo   WebApp      : http://localhost:8081
echo   Backend API : http://localhost:6060
echo ========================================
echo.
echo Backend va React serverlarini ham yoqing!
echo   Backend : npm run dev  (portpos-saas papkasida)
echo   Admin   : npm start    (botpos-admin papkasida, port 3000)
echo   WebApp  : npm start    (botpos-webapp papkasida, port 3001)
echo.
pause
