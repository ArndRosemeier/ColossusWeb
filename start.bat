@echo off
setlocal
cd /d "%~dp0web"

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Starting Colossus web app...
call npm run dev

endlocal
