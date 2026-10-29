#!/bin/bash
# Greenbox: start a small local web server here and open the cockpit (needed for the 3D tab).
cd "$(dirname "$0")"
PORT=8080
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done
( sleep 1; open "http://localhost:$PORT/Greenbox-Cockpit.html" ) &
python3 serve.py $PORT
