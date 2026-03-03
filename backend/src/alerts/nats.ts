import { NatsConnection, StringCodec, AckPolicy, DeliverPolicy, JetStreamManager, RetentionPolicy, StorageType } from 'nats';
import { Alert } from '../shared/types.js';

const sc = StringCodec();

export async function setupAlertsJetStream(nc: NatsConnection) {
    const nodeName = process.env.NODE_NAME || 'node_a';
    const peerNodeName = process.env.PEER_NODE_NAME || 'node_b';
    const localStreamName = 'SAFETY_ALERTS';
    const mirrorStreamName = `MIRROR_SAFETY_${peerNodeName.toUpperCase()}`;
    const peerDomain = peerNodeName;

    const jsm = await nc.jetstreamManager();
    await cleanupStaleStreams(jsm, nodeName, peerNodeName);

    // 1. Create Local Stream
    try {
        await jsm.streams.add({
            name: localStreamName,
            subjects: [`alert.safety.${nodeName}.>`],
            retention: RetentionPolicy.Limits,
            max_msgs: 10000,
            storage: StorageType.File,
        });
        console.log(`[${nodeName}] Local stream ${localStreamName} ready`);
    } catch (e: any) {
        if (!e.message?.includes('already')) console.warn(`Local stream note: ${e.message}`);
    }

    // 2. Create Mirror Stream
    try {
        await jsm.streams.add({
            name: mirrorStreamName,
            mirror: {
                name: localStreamName,
                external: { api: `$JS.${peerDomain}.API` },
            },
            retention: RetentionPolicy.Limits,
            max_msgs: 10000,
            storage: StorageType.File,
        });
        console.log(`[${nodeName}] Mirror stream ${mirrorStreamName} (Peer: ${peerDomain}) ready`);
    } catch (e: any) {
        if (!e.message?.includes('already')) console.warn(`Mirror stream note: ${e.message}`);
    }

    return [localStreamName, mirrorStreamName];
}

async function cleanupStaleStreams(jsm: JetStreamManager, nodeName: string, peerNodeName: string) {
    const mirrorStreamName = `MIRROR_SAFETY_${peerNodeName.toUpperCase()}`;
    try {
        const streams = await jsm.streams.list().next();
        for (const si of streams) {
            if (si.config.name !== 'SAFETY_ALERTS' &&
                si.config.name !== mirrorStreamName &&
                si.config.subjects?.some((s: string) => s.startsWith('alert.safety'))) {
                console.log(`[${nodeName}] Deleting stale stream: ${si.config.name}`);
                await jsm.streams.delete(si.config.name);
            }
        }
    } catch (e: any) {
        console.log(`[${nodeName}] Stale stream cleanup note: ${e.message}`);
    }
}

export async function consumeAlerts(nc: NatsConnection, streamNames: string[]) {
    const nodeName = process.env.NODE_NAME || 'node_a';
    const js = nc.jetstream();

    for (const streamName of streamNames) {
        const consumerName = `${nodeName}_${streamName.toLowerCase()}_backend_consumer`;
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
                        const data: Alert = JSON.parse(sc.decode(msg.data));
                        console.log(`[${nodeName}] BACKEND LOG [ACK]: ${data.type} from ${data.node} - ${data.message}`);
                        msg.ack();
                    } catch (e) {
                        msg.nak();
                    }
                }
            })();
            console.log(`[${nodeName}] Backend consuming from ${streamName} for logging`);
        } catch (e: any) {
            console.warn(`[${nodeName}] Backend consumer for ${streamName} error: ${e.message}`);
        }
    }
}

export async function publishAlert(nc: NatsConnection, alert: Omit<Alert, 'timestamp' | 'node'>) {
    const nodeName = process.env.NODE_NAME || 'node_a';
    const js = nc.jetstream();
    const payload: Alert = {
        ...alert,
        node: nodeName,
        timestamp: new Date().toISOString(),
    };
    await js.publish(`alert.safety.${nodeName}.${alert.type}`, sc.encode(JSON.stringify(payload)));
    return payload;
}
