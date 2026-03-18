#!/bin/bash

# ==============================================================================
# Facetime - AWS EC2 Production Deployment Script
# ==============================================================================
# This scripts configures and launches the app for a production environment.
# It automatically queries the AWS EC2 Metadata API (IMDSv2) to bind the correct
# public IP to the Mediasoup SFU router.
# ==============================================================================

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}      Starting Facetime AWS Production Setup          ${NC}"
echo -e "${BLUE}======================================================${NC}"

# 1. Get EC2 Public IP using IMDSv2
echo -e "${YELLOW}[1/4] Retrieving EC2 Public IP...${NC}"
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" -s)
PUBLIC_IP=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -s http://169.254.169.254/latest/meta-data/public-ipv4)

if [ -z "$PUBLIC_IP" ] || [[ "$PUBLIC_IP" == *"html"* ]]; then
    echo -e "${RED}Error: Could not retrieve public IP from AWS metadata endpoint.${NC}"
    echo "This script must be run inside an AWS EC2 instance!"
    echo "If you are running this elsewhere, please manually export PUBLIC_IP first."
    exit 1
fi
echo -e "Found AWS Public IP: ${GREEN}$PUBLIC_IP${NC}"

# 2. Configure Environment Variables
echo -e "${YELLOW}[2/4] Generating Production .env configurations...${NC}"
SERVER_ENV_PATH="./server/.env"
CLIENT_ENV_PATH="./client/.env.local"

# Node.js SFU Environment
echo "PORT=4000" > $SERVER_ENV_PATH
echo "NODE_ENV=production" >> $SERVER_ENV_PATH
echo "MEDIASOUP_LISTEN_IP=0.0.0.0" >> $SERVER_ENV_PATH
# This is explicitly required so remote clients know where to send UDP video packets
echo "MEDIASOUP_ANNOUNCED_IP=$PUBLIC_IP" >> $SERVER_ENV_PATH
echo "CLIENT_ORIGIN=http://$PUBLIC_IP:3000" >> $SERVER_ENV_PATH

# Next.js Environment
echo "NEXT_PUBLIC_WS_URL=ws://$PUBLIC_IP:4000" > $CLIENT_ENV_PATH

# 3. Build the Next.js production payload
echo -e "${YELLOW}[3/4] Building Next.js Production Client...${NC}"
cd client
npm install
npm run build
cd ..

# Install Node.js backend dependencies
echo -e "${YELLOW}Installing Backend Dependencies...${NC}"
cd server
npm install
npm run build
cd ..

# 4. Start the Application
echo -e "${YELLOW}[4/4] Starting Services...${NC}"
echo -e "${RED}⚠️ IMPORTANT AWS SECURITY GROUP REQUIREMENTS ⚠️${NC}"
echo "Please ensure the EC2 Security Group for this instance has the following inbound rules open:"
echo " - TCP: 3000 (React Frontend UI)"
echo " - TCP: 4000 (WebSocket Signaling)"
echo " - UDP: 40000 - 49999 (Mediasoup WebRTC Video/Audio Streaming)"
echo -e "${BLUE}======================================================${NC}"

# Define a trap to cleanly stop background jobs
trap 'kill 0' SIGINT

cd server && npm run start &
pid_backend=$!

cd client && npm run start &
pid_frontend=$!

echo -e "🌐 Platform is live at: ${GREEN}http://$PUBLIC_IP:3000${NC}"
wait $pid_backend $pid_frontend
