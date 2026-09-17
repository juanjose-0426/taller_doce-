@echo off
title BiblioTiempoDoce - Biblioteca 12 de Octubre
color 0B
cls
echo ========================================================
echo       BIBLIOTIEMPODOCE - BIBLIOTECA 12 DE OCTUBRE
echo       Sistema de Gestion y Control de Computadores
echo ========================================================
echo.
echo Iniciando servidor del sistema...
echo.

:: Abre automaticamente el navegador tras 2 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

:: Ejecuta el servidor Node.js
node backend/server.js

pause
