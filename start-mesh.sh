#!/usr/bin/env bash

# Distributed Mesh POC - Start Script
# Uses a generic docker-compose.yml and runs multiple isolated projects (Node A and Node B).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "=== Distributed Mesh POC: Full Cluster Start ==="

# 1) Generate node environments
cat shared.env node-a/values.env > node-a/.env
cat shared.env node-b/values.env > node-b/.env

# 2) Ensure mesh network exists
if ! docker network ls | grep -q "mesh-net"; then
  echo "Creating mesh-net network..."
  docker network create mesh-net
else
  echo "mesh-net network already exists"
fi

# 3) Cleanup for a brand new state
echo "Cleaning up existing containers and volumes..."
docker compose -p node-a --env-file node-a/.env down -v --remove-orphans || true
docker compose -p node-b --env-file node-b/.env down -v --remove-orphans || true

# 4) Start Phase
echo "=== Phase 2: Starting Node A ==="
docker compose -p node-a --env-file node-a/.env up -d --build

echo "=== Phase 3: Starting Node B ==="
docker compose -p node-b --env-file node-b/.env up -d --build

# Source the frontend ports for output message
source node-a/.env
A_FRONTEND_HOST_PORT=$FRONTEND_HOST_PORT
source node-b/.env
B_FRONTEND_HOST_PORT=$FRONTEND_HOST_PORT

echo ""
echo "Distributed Mesh POC is now running!"
echo "Node A Dashboard: http://localhost:${A_FRONTEND_HOST_PORT}"
echo "Node B Dashboard: http://localhost:${B_FRONTEND_HOST_PORT}"
