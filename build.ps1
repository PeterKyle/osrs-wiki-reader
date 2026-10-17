# Builds dist\OSRS Wiki Reader.exe (a single file you can share).
# Usage:  powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path .venv)) {
    python -m venv .venv
    .\.venv\Scripts\python.exe -m pip install pywebview pyinstaller
}

.\.venv\Scripts\pyinstaller.exe app.py `
    --name "OSRS Wiki Reader" `
    --onefile --windowed --noconfirm --clean `
    --icon ui\icon.ico `
    --version-file version_info.txt `
    --add-data "ui;ui" `
    --exclude-module tkinter --exclude-module unittest --exclude-module pydoc `
    --exclude-module PyQt5 --exclude-module PyQt6 --exclude-module PySide2 --exclude-module PySide6 --exclude-module gi

Get-Item "dist\OSRS Wiki Reader.exe" | Select-Object Name, @{n="MB";e={[math]::Round($_.Length/1MB,1)}}
