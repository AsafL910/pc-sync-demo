FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src/ ./src/

# Conservative memory limit for edge device simulation
ENV NODE_OPTIONS="--max-old-space-size=128"

# Default entrypoint; overridden per service in docker-compose
CMD ["node", "src/db-sync-service.js"]
