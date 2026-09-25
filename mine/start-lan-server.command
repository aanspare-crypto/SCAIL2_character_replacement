#!/bin/bash
# Double-click on macOS (or run in a terminal on Linux) to start the Blackdamp LAN server.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Node.js is not installed. Get it from https://nodejs.org"; read -r -p "Press Enter to close"; exit 1; fi
node server.js
