#!/bin/bash

# ==============================================================================
# Facetime - Unified Local Development Server Script
# ==============================================================================
# This script automatically determines your local network IP, sets up the
# Mediasoup SFU environment variables, starts an ngrok tunnel for public access,
# and boots both the Node.js backend and Next.js frontend in parallel.
# ==============================================================================

# 1. Colors and Formatting
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}      Starting Facetime Local Development Setup       ${NC}"
echo -e "${BLUE}======================================================${NC}"

# Clean up any previously running servers/tunnels on our ports
echo -e "${YELLOW}[1/5] Cleaning up old processes...${NC}"
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:4000 | xargs kill -9 2>/dev/null
killall ngrok 2>/dev/null

# 2. Get the Local IP Address (macOS specific for WiFi interface en0)
echo -e "${YELLOW}[2/5] Detecting Local IP Address...${NC}"
LOCAL_IP=$(ipconfig getifaddr en0)

if [ -z "$LOCAL_IP" ]; then
    echo -e "${RED}Error: Could not determine local IP address on en0.${NC}"
    echo "Fallback: Using 127.0.0.1 (Remote devices will not be able to connect)"
    LOCAL_IP="127.0.0.1"
fi
echo -e "Found Local IP: ${GREEN}$LOCAL_IP${NC}"

# 3. Start ngrok in the background and grab the URL
echo -e "${YELLOW}[3/5] Starting ngrok tunnel on port 3000...${NC}"
ngrok http 3000 > /dev/null &
sleep 3 # Wait for ngrok to initialize

# Fetch the public URL from the local ngrok API
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"[^"]*' | grep 'https' | cut -d '"' -f 4)

if [ -z "$NGROK_URL" ]; then
    echo -e "${RED}Error: Failed to fetch ngrok URL. Make sure ngrok is installed and authenticated.${NC}"
    NGROK_URL="http://localhost:3000"
else
    echo -e "ngrok Tunnel Established at: ${GREEN}$NGROK_URL${NC}"
fi

# 4. Update the Server .env File
echo -e "${YELLOW}[4/5] Updating server/.env configuration...${NC}"
SERVER_ENV_PATH="./server/.env"
CLIENT_ENV_PATH="./client/.env.local"

# Write backend .env
echo "PORT=4000" > $SERVER_ENV_PATH
echo "NODE_ENV=development" >> $SERVER_ENV_PATH
echo "MEDIASOUP_LISTEN_IP=0.0.0.0" >> $SERVER_ENV_PATH
echo "MEDIASOUP_ANNOUNCED_IP=$LOCAL_IP" >> $SERVER_ENV_PATH
echo "CLIENT_ORIGIN=$NGROK_URL" >> $SERVER_ENV_PATH

# Do NOT set NEXT_PUBLIC_WS_URL for local dev.
# The Next.js rewrite proxies /ws -> localhost:4000, so getWsUrl() derives the
# correct wss:// or ws:// protocol from window.location automatically.
echo "# Local dev: WebSocket is proxied via Next.js rewrite at /ws" > $CLIENT_ENV_PATH

# 5. Start Frontend and Backend Concurrently
echo -e "${YELLOW}[5/5] Booting up Next.js UI and Node.js SFU server...${NC}"

# Define a trap to cleanly stop background jobs when the script exits
trap 'kill 0' SIGINT

cd server && npm run dev &
pid_backend=$!

cd client && npm run dev &
pid_frontend=$!

echo -e "${BLUE}======================================================${NC}"
echo -e "${GREEN}✓ All services are starting up!${NC}"
echo -e "👉 Network Access URL: ${GREEN}$NGROK_URL${NC}"
echo -e "👉 Local Access URL:   ${GREEN}http://localhost:3000${NC}"
echo -e "👉 SFU WebSocket URL:  ${GREEN}ws://$LOCAL_IP:4000${NC}"
echo -e "${BLUE}======================================================${NC}"
echo -e "Press Ctrl+C to stop all servers and close the tunnel."

# Wait indefinitely until interrupted
wait $pid_backend $pid_frontend
