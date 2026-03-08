import { NatsConnection, StringCodec, JetStreamManager, RetentionPolicy, StorageType } from 'nats';

const sc = StringCodec();

export interface MissionCreatedEvent {
    id: string;
    name: string;
    created_at: string;
    node: string;
    timestamp: string;
}

export async function setupMissionJetStream(nc: NatsConnection) {
    const nodeName = process.env.NODE_NAME || 'node_a';
    const peerNodeName = process.env.PEER_NODE_NAME || 'node_b';
    const localStreamName = 'MISSIONS';
    const mirrorStreamName = `MIRROR_MISSIONS_${peerNodeName.toUpperCase()}`;
    const peerDomain = peerNodeName;

    const jsm = await nc.jetstreamManager();

    try {
        await jsm.streams.add({
            name: localStreamName,
            subjects: [`mission.lifecycle.${nodeName}.>`],
            retention: RetentionPolicy.Limits,
            max_msgs: 10000,
            storage: StorageType.File,
        });
        console.log(`[${nodeName}] Local stream ${localStreamName} ready`);
    } catch (e: any) {
        if (!e.message?.includes('already')) console.warn(`Local mission stream note: ${e.message}`);
    }

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
        if (!e.message?.includes('already')) console.warn(`Mirror mission stream note: ${e.message}`);
    }

    return [localStreamName, mirrorStreamName];
}

export async function publishMissionCreated(nc: NatsConnection, mission: { id: string; name: string; created_at: string; }) {
    const nodeName = process.env.NODE_NAME || 'node_a';
    const js = nc.jetstream();
    const payload: MissionCreatedEvent = {
        ...mission,
        node: nodeName,
        timestamp: new Date().toISOString(),
    };

    const msgId = `mission-${mission.id}`;
    await js.publish(
        `mission.lifecycle.${nodeName}.created`,
        sc.encode(JSON.stringify(payload)),
        { msgID: msgId }
    );

    return payload;
}
