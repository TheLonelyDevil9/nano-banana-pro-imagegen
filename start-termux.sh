#!/data/data/com.termux/files/usr/bin/bash
# Nano Banana Pro - Termux Launcher
# Run this script, then you can close Termux - server keeps running
#
# Usage: bash start-termux.sh
# Or make executable: chmod +x start-termux.sh && ./start-termux.sh

cd "$(dirname "$0")"

# Kill any existing server on port 3000
pkill -f "serve -l 3000" 2>/dev/null

# Start server in background
nohup npx -y serve -l 3000 > /dev/null 2>&1 &

echo "Server starting on http://localhost:3000"
sleep 2

# Open browser (requires Termux:API)
if command -v termux-open-url &> /dev/null; then
    termux-open-url http://localhost:3000
else
    echo "Open http://localhost:3000 in your browser"
    echo "(Install termux-api for auto-open: pkg install termux-api)"
fi

echo ""
echo "You can close Termux - server runs in background"
echo "To stop: pkill -f 'serve -l 3000'"
