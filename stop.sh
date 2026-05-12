#!/bin/bash

echo "▶ Stopping Mobile Cloud Browser..."

PIDS=$(pgrep -f "node server.js" 2>/dev/null)

if [ -z "$PIDS" ]; then
  echo "  No running server.js process found."
else
  echo "  Killing PID(s): $PIDS"
  kill $PIDS
  echo "  ✅ Stopped."
fi
