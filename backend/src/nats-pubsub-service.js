/**
 * NATS Pub/Sub Service
 * - Subscribes to sensor.gps (plain NATS pub/sub)
 * - WebSocket server to forward GPS events to React clients
 */

const http = require('http');
const express = require('express');
const cors = require('cors');
const { connect, StringCodec } = require('nats');

const NODE_NAME = process.env.NODE_NAME || 'node_a';
const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const PORT = parseInt(process.env.PORT || '3100', 10);

const sc = StringCodec();

const app = express();
app.use(cors());

app.get('/health', (req, res) => {
    res.json({ status: 'ok', node: NODE_NAME, service: 'nats-pubsub' });
});

const server = http.createServer(app);

async function connectNats() {
    let nc;
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
        try {
            nc = await connect({ servers: NATS_URL, name: `${NODE_NAME}-pubsub` });
            console.log(`[${NODE_NAME}] Connected to NATS at ${NATS_URL}`);
            break;
        } catch (err) {
            console.log(`[${NODE_NAME}] NATS not ready, retry ${i + 1}/${maxRetries}...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    if (!nc) throw new Error('Failed to connect to NATS');
    return nc;
}

async function start() {
    const nc = await connectNats();

    // Subscribe to sensor.gps (plain pub/sub) for logging/monitoring
    // The sensors (via gps-simulator) push data onto this subject.
    // The browser now subscribes directly to NATS.
    const gpsSub = nc.subscribe('sensor.gps');
    (async () => {
        for await (const msg of gpsSub) {
            try {
                const data = JSON.parse(sc.decode(msg.data));
                console.log(`[${NODE_NAME}] MESH MONITORING -> GPS from ${data.node}: lat=${data.lat}, lng=${data.lng}`);
            } catch (e) {
                console.error(`[${NODE_NAME}] GPS parse error:`, e.message);
            }
        }
    })();

    console.log(`[${NODE_NAME}] Monitoring sensor.gps on the mesh`);

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`[${NODE_NAME}] NATS Pub/Sub Service listening on port ${PORT}`);
    });

    // Handle graceful shutdown
    const shutdown = async () => {
        console.log(`[${NODE_NAME}] Shutting down NATS Pub/Sub...`);
        await nc.drain();
        server.close();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

start().catch(err => {
    console.error(`[${NODE_NAME}] Fatal:`, err);
    process.exit(1);
});
