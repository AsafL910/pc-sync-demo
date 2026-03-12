#!/usr/bin/env bash

# Distributed Mesh POC - Start Script
# Uses a generic docker-compose.yml and runs multiple isolated projects (Node A and Node B).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "=== Distributed Mesh POC: Full Cluster Start ==="

# Shared + node-specific env files (layered, node values win)
ENV_A="--env-file shared.env --env-file node-a/values.env"
ENV_B="--env-file shared.env --env-file node-b/values.env"

# 1) Ensure mesh network exists
if ! docker network ls | grep -q "mesh-net"; then
  echo "Creating mesh-net network..."
  docker network create mesh-net
else
  echo "mesh-net network already exists"
fi

# 2) Cleanup for a brand new state
echo "Cleaning up existing containers and volumes..."
docker compose -p node-a $ENV_A down -v --remove-orphans || true
docker compose -p node-b $ENV_B down -v --remove-orphans || true
docker compose -f docker-compose.pgadmin.yml -p mesh-tools down -v --remove-orphans || true

# 3) Start Phase
echo "=== Phase 2: Starting Node A ==="
docker compose -p node-a $ENV_A up -d --build

echo "=== Phase 3: Starting Node B ==="
docker compose -p node-b $ENV_B up -d --build

echo "=== Phase 4: Starting shared pgAdmin ==="
docker compose -f docker-compose.pgadmin.yml -p mesh-tools up -d

echo ""
echo "Distributed Mesh POC is now running!"
echo "Node A Dashboard: http://localhost:5173"
echo "Node B Dashboard: http://localhost:5174"
echo "pgAdmin:          http://localhost:5050"
