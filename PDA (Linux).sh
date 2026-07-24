#!/bin/bash
cd "$(dirname "$0")"

if [ ! -f "./app/server.js" ]; then
  echo ""
  echo "  It looks like you're running this from inside the .zip."
  echo "  Extract the whole folder first, then run PDA from there."
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed yet.  Install it, e.g.:  sudo apt install nodejs"
  echo "  Then run PDA again."
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

echo ""
echo "  Starting PDA..."
echo "  A browser window will open automatically (if a desktop is present)."
echo "  Keep this window open while the shop is running (Ctrl+C to stop)."
echo ""
cd app
node server.js
