@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-repo-intake.ps1"
exit /b %ERRORLEVEL%
