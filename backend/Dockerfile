FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
# Install all dependencies including devDependencies for ts-node/typescript
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Conservative memory limit for edge device simulation
ENV NODE_OPTIONS="--max-old-space-size=128"

# Default entrypoint; overridden per service in docker-compose
CMD ["npm", "run", "mission-service"]
