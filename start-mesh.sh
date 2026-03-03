#!/bin/bash

# Distributed Mesh POC - Start Script
# This script ensures a clean start for the entire mesh cluster.

echo "━━━ Distributed Mesh POC: Full Cluster Start ━━━"

# 1. Ensure mesh network exists
if ! docker network ls | grep -q "mesh-net"; then
  echo "ℹ Creating mesh-net network..."
  docker network create mesh-net
else
  echo "✓ mesh-net network already exists"
fi

# 2. Cleanup function
cleanup() {
  echo "━━━ Cleaning up existing containers and volumes ━━━"
  cd node-a && docker compose down -v
  cd ../node-b && docker compose down -v
  cd ..
}

# Run cleanup first to ensure "brand new" state
cleanup

echo "━━━ Building and Starting Node A ━━━"
cd node-a
docker compose up -d --build
if [ $? -ne 0 ]; then echo "❌ Failed to start Node A"; exit 1; fi

echo "━━━ Building and Starting Node B ━━━"
cd ../node-b
docker compose up -d --build
if [ $? -ne 0 ]; then echo "❌ Failed to start Node B"; exit 1; fi

cd ..

echo ""
echo "✨ Distributed Mesh POC is now running!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Node A Dashboard: http://localhost:5173"
echo "Node B Dashboard: http://localhost:5174"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Run './test-resiliency.sh' to verify data sync and failover."
