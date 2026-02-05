#!/bin/bash
# Nano Banana Pro - Linux/Mac Start Script
# Run: chmod +x start.sh && ./start.sh

cd "$(dirname "$0")"
echo "Starting Nano Banana Pro..."
echo ""

# Find a free port starting from 3000
PORT=3000
while netstat -tuln 2>/dev/null | grep -q ":$PORT " || ss -tuln 2>/dev/null | grep -q ":$PORT "; do
    PORT=$((PORT + 1))
    if [ $PORT -gt 3100 ]; then
        PORT=3000
        break
    fi
done

echo "Server will run at http://localhost:$PORT"
echo "Press Ctrl+C to stop"
echo ""

# Open browser (works on Linux and Mac)
if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:$PORT" &
elif command -v open &> /dev/null; then
    open "http://localhost:$PORT" &
fi

npx -y serve -l "$PORT"
