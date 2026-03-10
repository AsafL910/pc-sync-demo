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
# We ignore errors here in case the projects don't exist yet
docker compose -p node-a --env-file node-a/.env down -v || true
docker compose -p node-b --env-file node-b/.env down -v || true

# 4) Build + start
echo "Building and starting full mesh (Node A + Node B)..."
docker compose -p node-a --env-file node-a/.env up -d --build
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
echo "Run './test-resiliency.sh' to verify data sync and failover."
