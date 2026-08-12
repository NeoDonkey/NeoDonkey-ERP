@echo off
REM Double-click this file. That is the whole procedure.
REM
REM It starts the small static server in this folder, opens your browser, and stays running
REM until you close this window. Nothing is installed and nothing leaves this folder.
REM
REM A real NeoDonkey user never needs this: they visit a web address once and click "Install".

cd /d "%~dp0"
set PORT=8080
set URL=http://127.0.0.1:%PORT%

echo.
echo   NeoDonkey
echo   %cd%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed, and this folder needs it to serve itself.
  echo.
  echo       https://nodejs.org   ^(the LTS download, then double-click this file again^)
  echo.
  echo   NeoDonkey itself has no dependencies at all - Node only hands the browser the files.
  echo.
  pause
  exit /b 1
)

start "" "%URL%"
echo   Open in your browser:  %URL%
echo.
echo   Your browser will offer to install NeoDonkey as an app - accept it, and you get an
echo   icon and a window of its own, and it works offline from then on.
echo.
echo   Close this window to stop the server. Your company is not in here; it is in the
echo   folder you choose on first launch.
echo.

node serve.mjs
