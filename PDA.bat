@echo off
title PDA
cd /d "%~dp0"

if not exist "%~dp0server.js" (
  echo.
  echo   It looks like you opened this from INSIDE the .zip file.
  echo   Windows can't run it that way.
  echo.
  echo   Please EXTRACT first:
  echo     1. Right-click  kafeneio-pos.zip
  echo     2. Choose  "Extract All..."  and confirm
  echo     3. Open the extracted folder
  echo     4. Double-click PDA again from there
  echo.
  pause
  exit /b
)

REM --- make a pretty "PDA" icon on the Desktop the first time ---
set "LNK=%USERPROFILE%\Desktop\PDA.lnk"
if not exist "%LNK%" (
  powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath='%~f0'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0icon.ico'; $s.Save()" >nul 2>nul
  if exist "%LNK%" echo   A "PDA" icon was placed on your Desktop - use that from now on.
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed yet.
  echo   Please install it once from:  https://nodejs.org
  echo   Then double-click PDA again.
  echo.
  pause
  exit /b
)

echo.
echo   Starting PDA...
echo   A browser window will open automatically.
echo   KEEP THIS WINDOW OPEN while the shop is running.
echo   Close it (or press Ctrl+C) to stop.
echo.
node server.js
pause
