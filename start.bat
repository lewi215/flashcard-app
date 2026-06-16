@echo off
cd /d "%~dp0"
start "" /B venv\Scripts\python.exe app.py > logs\app.log 2>&1
