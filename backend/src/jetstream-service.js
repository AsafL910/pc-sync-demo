/**
 * JetStream Service
 * - Creates JetStream stream SAFETY_ALERTS for alert.safety.>
 * - Configures stream mirroring of peer's stream
 * - Consumes with client-side ACK
 * - WebSocket for real-time alerts to frontend
 */

const http = require('http');
const express = require('express');
const cors = require('cors');
const { connect, StringCodec, AckPolicy, DeliverPolicy } = require('nats');

const NODE_NAME = process.env.NODE_NAME || 'node_a';
const PEER_NODE_NAME = process.env.PEER_NODE_NAME || 'node_b';
const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const PORT = parseInt(process.env.PORT || '3200', 10);

const sc = StringCodec();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok', node: NODE_NAME, service: 'jetstream' });
});

// Note: POST /alerts is now handled directly by the frontend via NATS, 
// but we keep this endpoint as a legacy/API backup if needed.
app.post('/alerts', async (req, res) => {
    try {
        const { type = 'collision', severity = 'high', message = 'Safety alert', data = {} } = req.body;
        const payload = {
            node: NODE_NAME,
            type,
            severity,
            message,
            data,
            timestamp: new Date().toISOString(),
        };
        const js = globalNc.jetstream();
        await js.publish(`alert.safety.${NODE_NAME}.${type}`, sc.encode(JSON.stringify(payload)));
        console.log(`[${NODE_NAME}] Published safety alert: ${NODE_NAME}.${type}`);
        res.status(201).json(payload);
    } catch (err) {
        console.error(`[${NODE_NAME}] Alert publish error:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

const server = http.createServer(app);

let globalNc;

async function connectNats() {
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const nc = await connect({ servers: NATS_URL, name: `${NODE_NAME}-jetstream` });
            console.log(`[${NODE_NAME}] Connected to NATS at ${NATS_URL}`);
            return nc;
        } catch (err) {
            console.log(`[${NODE_NAME}] NATS not ready, retry ${i + 1}/${maxRetries}...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    throw new Error('Failed to connect to NATS');
}

async function cleanupStaleStreams(jsm) {
    // Remove any old streams whose subjects overlap with alert.safety.>
    const mirrorStreamName = `MIRROR_SAFETY_${PEER_NODE_NAME.toUpperCase()}`;
    try {
        const streams = await jsm.streams.list().next();
        for (const si of streams) {
            if (si.config.name !== 'SAFETY_ALERTS' &&
                si.config.name !== mirrorStreamName &&
                si.config.subjects?.some(s => s.startsWith('alert.safety'))) {
                console.log(`[${NODE_NAME}] Deleting stale stream: ${si.config.name}`);
                await jsm.streams.delete(si.config.name);
            }
        }
    } catch (e) {
        console.log(`[${NODE_NAME}] Stale stream cleanup note: ${e.message}`);
    }
}

async function setupJetStream(nc) {
    const jsm = await nc.jetstreamManager();
    const localStreamName = 'SAFETY_ALERTS';
    const mirrorStreamName = `MIRROR_SAFETY_${PEER_NODE_NAME.toUpperCase()}`;
    const peerDomain = PEER_NODE_NAME;

    await cleanupStaleStreams(jsm);

    // 1. Create Local Stream
    try {
        await jsm.streams.add({
            name: localStreamName,
            subjects: [`alert.safety.${NODE_NAME}.>`],
            retention: 'limits',
            max_msgs: 10000,
            storage: 'file',
        });
        console.log(`[${NODE_NAME}] Local stream ${localStreamName} ready`);
    } catch (e) {
        if (!e.message?.includes('already')) console.warn(`Local stream note: ${e.message}`);
    }

    // 2. Create Mirror Stream
    try {
        await jsm.streams.add({
            name: mirrorStreamName,
            mirror: {
                name: localStreamName, // Peer uses the same stream name convention
                external: { api: `$JS.${peerDomain}.API` },
            },
            retention: 'limits',
            max_msgs: 10000,
            storage: 'file',
        });
        console.log(`[${NODE_NAME}] Mirror stream ${mirrorStreamName} (Peer: ${peerDomain}) ready`);
    } catch (e) {
        if (!e.message?.includes('already')) console.warn(`Mirror stream note: ${e.message}`);
    }

    return [localStreamName, mirrorStreamName];
}

async function consumeAlerts(nc, streamNames) {
    const js = nc.jetstream();
    for (const streamName of streamNames) {
        const consumerName = `${NODE_NAME}_${streamName.toLowerCase()}_backend_consumer`;
        try {
            const jsm = await nc.jetstreamManager();
            await jsm.consumers.add(streamName, {
                durable_name: consumerName,
                ack_policy: AckPolicy.Explicit,
                deliver_policy: DeliverPolicy.All,
            });

            const consumer = await js.consumers.get(streamName, consumerName);
            const messages = await consumer.consume();

            (async () => {
                for await (const msg of messages) {
                    try {
                        const data = JSON.parse(sc.decode(msg.data));
                        console.log(`[${NODE_NAME}] BACKEND LOG [ACK]: ${data.type} from ${data.node} - ${data.message}`);
                        msg.ack();
                    } catch (e) {
                        msg.nak();
                    }
                }
            })();
            console.log(`[${NODE_NAME}] Backend consuming from ${streamName} for logging`);
        } catch (e) {
            console.warn(`[${NODE_NAME}] Backend consumer for ${streamName} error: ${e.message}`);
        }
    }
}

async function start() {
    const nc = await connectNats();
    globalNc = nc;

    await new Promise(r => setTimeout(r, 3000));
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`[${NODE_NAME}] JetStream Service listening on port ${PORT}`);
    });

    try {
        const streamNames = await setupJetStream(nc);
        // We still consume selectively for backend logging/processing
        await consumeAlerts(nc, streamNames);
    } catch (e) {
        console.error(`[${NODE_NAME}] Startup error:`, e.message);
    }

    const shutdown = async () => {
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
