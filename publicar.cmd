@echo off
chcp 65001 >nul
title Automações TASY - Publicar atualização online
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publicar.ps1"
echo.
pause
