FROM node:22-alpine AS builder

# mediasoup requires Python + build tools for native addon compilation
RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Production stage ──────────────────────────────────────────
FROM node:22-alpine AS runner

RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 4000
# Expose UDP range for mediasoup RTP
EXPOSE 40000-49999/udp

CMD ["node", "dist/index.js"]
