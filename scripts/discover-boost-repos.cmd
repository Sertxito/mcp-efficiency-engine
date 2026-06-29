@echo off
setlocal
python "%~dp0discover-boost-repos.py" %*
exit /b %ERRORLEVEL%
