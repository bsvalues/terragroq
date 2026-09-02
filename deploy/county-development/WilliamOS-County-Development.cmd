@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\county-development\Manage-WilliamOSCountyDevelopment.ps1" -Action Launch
if errorlevel 1 (
  echo.
  echo WilliamOS County Development did not start. Review the typed refusal above.
  pause
  exit /b 1
)
endlocal
