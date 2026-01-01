#!/bin/bash
# Nano Banana Pro - Linux/Mac Start Script
# Run: chmod +x start.sh && ./start.sh

cd "$(dirname "$0")"
echo "Starting Nano Banana Pro..."
echo ""
echo "Server will run at http://localhost:3000"
echo "Press Ctrl+C to stop"
echo ""

# Open browser (works on Linux and Mac)
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000 &
elif command -v open &> /dev/null; then
    open http://localhost:3000 &
fi

npx -y serve -l 3000
