# Distributed Mesh POC

This project is a Proof of Concept (POC) for a distributed mesh system simulating vehicle edge computers. It demonstrates a highly resilient architecture that allows two nodes (Node A and Node B) to operate independently, sync data bi-directionally, and communicate in real-time.

## Architecture Highlights
- **Distributed Nodes**: Two completely independent nodes running in separate Docker networks, communicating over an external `mesh-net` network.
- **Bi-Directional Database Sync**: Uses PostgreSQL with `pglogical` to asynchronously replicate local relation data across both nodes. Conflicts are handled using `pglogical.conflict_resolution` (first-update-wins).
- **Direct NATS-WebSocket Integration**: The React frontend connects *directly* to the NATS cluster via WebSockets (`nats.ws`). There are no traditional backend WebSockets or HTTP APIs relaying real-time data.
- **Resilient Real-time Messaging**: Uses NATS JetStream for durable safety alerts. The frontend utilizes the Explicit Consumer API (`JetStreamManager`) to bind to local and mirrored streams, ensuring data is never missed even if the browser disconnects.
- **TypeScript & React**: The web dashboard is built using React (Vite) and fully typed with TypeScript using modern arrow function components.

## Project Structure
```text
demo/
├── node-a/                 # Configuration for Node A
│   └── docker-compose.yml
├── node-b/                 # Configuration for Node B
│   └── docker-compose.yml
├── frontend/               # React Dashboard (Vite + TypeScript)
├── backend/                # Node.js microservices (GPS Simulator, DB Sync)
├── postgres/               # Custom PostgreSQL image with pglogical setup scripts
└── nats/                   # NATS server configuration (Leaf nodes + Websocket)
```

## Running the POC

1. **Start the Mesh Network**:
   ```bash
   docker network create mesh-net
   ```

2. **Start Node A**:
   ```bash
   cd node-a
   docker compose up -d
   ```
   *Dashboard*: http://localhost:5173

3. **Start Node B**:
   ```bash
   cd node-b
   docker compose up -d
   ```
   *Dashboard*: http://localhost:5174

## Features
- **Local DB State**: View synced database rows. Row insertions on one node appear on the other automatically.
- **Live GPS Feed**: Native NATS pub/sub stream demonstrating low latency sensor telemetry.
- **Safety Alerts (JetStream)**: Demonstrates mission-critical durable messaging. Generates alerts that are persisted and mirrored across the cluster. If you refresh the page or stop a node, JetStream ensures you receive all missed alerts when you reconnect.

## Testing Resiliency
You can use the automated test script to verify data sync and alert recovery capabilities:
```bash
./test-resiliency.sh
```
