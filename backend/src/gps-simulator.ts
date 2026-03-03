import { connect, StringCodec, NatsConnection, JetStreamClient } from 'nats';
import { ReservedAlert, GpsData, AlertSeverity } from './shared/types.js';

const NODE_NAME = process.env.NODE_NAME || 'node_a';
const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';

const sc = StringCodec();

const BASE_COORDS: Record<string, { lat: number, lng: number }> = {
    node_a: { lat: 32.0853, lng: 34.7818 }, // Tel Aviv
    node_b: { lat: 31.7683, lng: 35.2137 }, // Jerusalem
};

const base = { ...(BASE_COORDS[NODE_NAME] || BASE_COORDS.node_a) };
let heading = Math.random() * 360;

function generateGPS(): GpsData {
    heading += (Math.random() - 0.5) * 20;
    const speed = 30 + Math.random() * 80;
    const drift = 0.0001 * speed / 50;

    base.lat += Math.cos(heading * Math.PI / 180) * drift;
    base.lng += Math.sin(heading * Math.PI / 180) * drift;

    return {
        node: NODE_NAME,
        lat: parseFloat(base.lat.toFixed(6)),
        lng: parseFloat(base.lng.toFixed(6)),
        timestamp: new Date().toISOString(),
    };
}

async function connectNats(): Promise<NatsConnection> {
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const nc = await connect({ servers: NATS_URL, name: `${NODE_NAME}-gps-sim` });
            console.log(`[${NODE_NAME}] GPS Simulator connected to NATS`);
            return nc;
        } catch (err: any) {
            console.log(`[${NODE_NAME}] NATS not ready, retry ${i + 1}/${maxRetries}... (${err.message})`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    throw new Error('Failed to connect to NATS');
}

async function start() {
    const nc = await connectNats();
    const js = nc.jetstream();

    let tickCount = 0;

    const gpsInterval = setInterval(() => {
        const gps = generateGPS();
        nc.publish('sensor.gps', sc.encode(JSON.stringify(gps)));
        tickCount++;

        if (tickCount % 30 === 0) {
            const alert: ReservedAlert = {
                node: NODE_NAME,
                reservedType: 'collision',
                severity: Math.random() > 0.5 ? AlertSeverity.HIGH : AlertSeverity.MEDIUM,
                message: `Potential collision detected at (${gps.lat}, ${gps.lng})`,
                data: { lat: gps.lat, lng: gps.lng } as any,
                timestamp: new Date().toISOString(),
            };
            // Corrected subject to match service: alert.safety.${node}.${type}
            js.publish(`alert.safety.${NODE_NAME}.collision`, sc.encode(JSON.stringify(alert)))
                .then(() => console.log(`[${NODE_NAME}] Published safety alert`))
                .catch(e => console.error(`[${NODE_NAME}] Alert publish error:`, e.message));
        }
    }, 2000);

    console.log(`[${NODE_NAME}] GPS Simulator publishing every 2s`);

    const shutdown = async () => {
        clearInterval(gpsInterval);
        await nc.drain();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

start().catch(err => {
    console.error(`[${NODE_NAME}] Fatal:`, err);
    process.exit(1);
});
