#!/data/data/com.termux/files/usr/bin/bash
# Nano Banana Pro - Termux Launcher
# Run this script, then you can close Termux - server keeps running
#
# Usage: bash start-termux.sh
# Or make executable: chmod +x start-termux.sh && ./start-termux.sh

cd "$(dirname "$0")"

# Find a free port starting from 3000
PORT=3000
while ss -tuln 2>/dev/null | grep -q ":$PORT "; do
    PORT=$((PORT + 1))
    if [ $PORT -gt 3100 ]; then
        PORT=3000
        break
    fi
done

# Kill any existing server on port we're about to use
pkill -f "serve -l $PORT" 2>/dev/null

# Start server in background
nohup npx -y serve -l "$PORT" > /dev/null 2>&1 &

echo "Server starting on http://localhost:$PORT"
sleep 2

# Open browser (requires Termux:API)
if command -v termux-open-url &> /dev/null; then
    termux-open-url "http://localhost:$PORT"
else
    echo "Open http://localhost:$PORT in your browser"
    echo "(Install termux-api for auto-open: pkg install termux-api)"
fi

echo ""
echo "You can close Termux - server runs in background"
echo "To stop: pkill -f 'serve -l $PORT'"
