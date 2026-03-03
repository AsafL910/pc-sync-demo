import { NatsConnection, StringCodec } from 'nats';
import { GpsData } from '../shared/types.js';

const sc = StringCodec();

export async function setupGpsPubSub(nc: NatsConnection) {
    const nodeName = process.env.NODE_NAME || 'node_a';

    const gpsSub = nc.subscribe('sensor.gps');

    (async () => {
        for await (const msg of gpsSub) {
            try {
                const data: GpsData = JSON.parse(sc.decode(msg.data));
                console.log(`[${nodeName}] MESH MONITORING -> GPS from ${data.node}: lat=${data.lat}, lng=${data.lng}`);
            } catch (e: any) {
                console.error(`[${nodeName}] GPS parse error:`, e.message);
            }
        }
    })();

    console.log(`[${nodeName}] Monitoring sensor.gps on the mesh`);
}
