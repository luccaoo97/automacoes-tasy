@echo off
chcp 65001 >nul
title Automações TASY - instalar / atualizar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar.ps1"
echo.
pause
