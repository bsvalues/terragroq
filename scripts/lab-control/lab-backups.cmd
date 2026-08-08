@echo off
pwsh.exe -NoLogo -NoProfile -NonInteractive -File "%~dp0lab-backups.ps1" %*
