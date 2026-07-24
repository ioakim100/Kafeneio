#!/bin/bash
cd "$(dirname "$0")"

if [ ! -f "./app/server.js" ]; then
  echo ""
  echo "  It looks like you opened this from INSIDE the .zip file."
  echo "  Please unzip kafeneio-pos.zip first, then open PDA from the unzipped folder."
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed yet."
  echo "  Please install it once from:  https://nodejs.org"
  echo "  Then open PDA again."
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

echo ""
echo "  Starting PDA..."
echo "  A browser window will open automatically."
echo "  KEEP THIS WINDOW OPEN while the shop is running (Ctrl+C to stop)."
echo ""
cd app
node server.js
