@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0init-template-registry.ps1" %*
exit /b %ERRORLEVEL%