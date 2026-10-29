@echo off
REM Greenbox: start a local web server here and open the cockpit (needed for the 3D tab).
cd /d "%~dp0"
start "" http://localhost:8080/Greenbox-Cockpit.html
py serve.py 8080 2>nul || python serve.py 8080
