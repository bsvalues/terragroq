@echo off
pwsh.exe -NoLogo -NoProfile -NonInteractive -File "%~dp0lab-status.ps1" %*
