@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap-portable.ps1" %*
exit /b %ERRORLEVEL%