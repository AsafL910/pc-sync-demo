#!/usr/bin/env bash
# =============================================================================
# test-resiliency.sh — "Survival" Test for Independent Nodes Mesh
# Tests: Independent node startup, replication, and missing alert recovery
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

NODE_A_DB="http://localhost:3001"
NODE_B_DB="http://localhost:3002"
NODE_A_JS="http://localhost:3201"
NODE_B_JS="http://localhost:3202"

COMPOSE_A="node-a/docker-compose.yml"
COMPOSE_B="node-b/docker-compose.yml"

pass() { echo -e "  ${GREEN}✓ PASS${NC}: $1"; }
fail() { echo -e "  ${RED}✗ FAIL${NC}: $1"; FAILURES=$((FAILURES + 1)); }
info() { echo -e "  ${CYAN}ℹ${NC} $1"; }
section() { echo -e "\n${YELLOW}━━━ $1 ━━━${NC}"; }

FAILURES=0

# ---- Cleanup ----
cleanup() {
  section "Cleaning up existing containers..."
  docker compose -f $COMPOSE_A down -v > /dev/null 2>&1 || true
  docker compose -f $COMPOSE_B down -v > /dev/null 2>&1 || true
  docker network rm mesh-net > /dev/null 2>&1 || true
}

# ---- Setup ----
setup() {
  section "Initializing Mesh Environment"
  docker network create mesh-net > /dev/null 2>&1 || true
  info "Created external network 'mesh-net'"
}

# ---- Start Node A ----
start_node_a() {
  section "Test Step 1: Start Node A Standalone"
  docker compose -f $COMPOSE_A up -d --build
  
  info "Waiting for Node A to be healthy..."
  for i in $(seq 1 30); do
    if curl -sf "$NODE_A_DB/health" > /dev/null 2>&1; then
      pass "Node A is healthy"
      return 0
    fi
    sleep 2
  done
  fail "Node A failed to start"
  exit 1
}

# ---- Start Node B ----
start_node_b() {
  section "Test Step 2: Join Node B to Mesh"
  docker compose -f $COMPOSE_B up -d --build
  
  info "Waiting for Node B to join..."
  for i in $(seq 1 30); do
    if curl -sf "$NODE_B_DB/health" > /dev/null 2>&1; then
      pass "Node B joined and is healthy"
      return 0
    fi
    sleep 2
  done
  fail "Node B failed to start"
  exit 1
}

# ---- Data Replication Test ----
test_replication() {
  section "Test Step 3: Verify Bi-directional Data Replication"
  
  # A -> B
  UUID_A=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "test-a-$(date +%s)")
  info "Inserting relation on Node A: $UUID_A"
  curl -sf -X POST "$NODE_A_DB/relations" \
    -H "Content-Type: application/json" \
    -d "{\"relation_id\": \"$UUID_A\", \"point_id\": \"P-A\", \"polygon_id\": \"POLY-A\", \"status\": \"connected\"}" \
    > /dev/null
    
  # B -> A
  UUID_B=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "test-b-$(date +%s)")
  info "Inserting relation on Node B: $UUID_B"
  curl -sf -X POST "$NODE_B_DB/relations" \
    -H "Content-Type: application/json" \
    -d "{\"relation_id\": \"$UUID_B\", \"point_id\": \"P-B\", \"polygon_id\": \"POLY-B\", \"status\": \"connected\"}" \
    > /dev/null
    
  info "Waiting 12s for bi-directional catch-up..."
  sleep 12
  
  # Check A contents on B
  if curl -sf "$NODE_B_DB/relations" | grep -q "$UUID_A"; then
    pass "Data replicated A -> B"
  else
    fail "Replication A -> B FAILED"
  fi

  # Check B contents on A
  if curl -sf "$NODE_A_DB/relations" | grep -q "$UUID_B"; then
    pass "Data replicated B -> A"
  else
    fail "Replication B -> A FAILED"
  fi
}

# ---- Missing Alert Recovery Test ----
test_alert_recovery() {
  section "Test Step 4: Drop Node B and Recover Alerts"
  
  info "Powering off Node B (docker compose down)..."
  docker compose -f $COMPOSE_B down > /dev/null 2>&1
  pass "Node B is offline"
  
  ALERT_MSG="Safety Alert while B was DOWN at $(date)"
  info "Publishing safety alert on Node A..."
  curl -sf -X POST "$NODE_A_JS/alerts" \
    -H "Content-Type: application/json" \
    -d "{\"type\": \"collision\", \"severity\": \"critical\", \"message\": \"$ALERT_MSG\"}" \
    > /dev/null
  pass "Alert published to Node A JetStream"
  
  info "Restarting Node B (with --build)..."
  docker compose -f $COMPOSE_B up -d --build
  
  info "Waiting for Node B to catch up..."
  sleep 15
  
  # We check the logs of Node B's jetstream service for the message
  info "Checking Node B logs for the alert msg..."
  if docker logs jetstream_b 2>&1 | grep -q "$ALERT_MSG"; then
    pass "Node B retrieved missing alert from Node A JetStream!"
  else
    fail "Node B did NOT retrieve the missing alert"
    docker logs jetstream_b | tail -n 20
  fi
}

# ---- Main ----
cleanup
setup
start_node_a
start_node_b
test_replication
test_alert_recovery

section "Final Summary"
if [ "$FAILURES" -eq 0 ]; then
  echo -e "\n  ${GREEN}DISTRIBUTED MESH SURVIVED! ✓${NC}\n"
else
  echo -e "\n  ${RED}${FAILURES} TEST(S) FAILED! ✗${NC}\n"
fi
