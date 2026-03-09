import pg from 'pg';
import { connect, StringCodec } from 'nats';
import { EntityDelta } from '../shared/types.js';

const { Client } = pg;

const NODE_NAME = process.env.NODE_NAME || 'node_a';
const PEER_NODE_NAME = process.env.PEER_NODE_NAME || 'node_b';
const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
const DB_USER = process.env.DB_USER || 'mesh';
const DB_PASS = process.env.DB_PASS || 'mesh_pass';
const DB_NAME = process.env.DB_NAME || 'meshdb';

const ENTITY_DELTA_SUBJECT = `mission.entities.delta.${NODE_NAME}`;
const MISSION_DELTA_SUBJECT = `mission.lifecycle.${NODE_NAME}.created`;

const sc = StringCodec();

async function ensureStream(jsm: any, name: string, config: any, alreadyExistsMessage: string) {
    try {
        await jsm.streams.add(config);
        console.log(alreadyExistsMessage);
    } catch (err) {
        if (!(err as Error).message.includes('already exists')) {
            throw err;
        }
    }
}

async function startBridge() {
    console.log(`[Bridge ${NODE_NAME}] Starting...`);

    const nc = await connect({ servers: NATS_URL });
    const jsm = await nc.jetstreamManager();
    const js = nc.jetstream();
    console.log(`[Bridge ${NODE_NAME}] Connected to NATS.`);

    await ensureStream(jsm, 'ENTITIES', {
        name: 'ENTITIES',
        subjects: [ENTITY_DELTA_SUBJECT],
        duplicate_window: 5000000000,
        max_msgs: 10000,
    }, `[Bridge ${NODE_NAME}] Created/Updated local JetStream ENTITIES.`);

    await ensureStream(jsm, `MIRROR_ENTITIES_${PEER_NODE_NAME.toUpperCase()}`, {
        name: `MIRROR_ENTITIES_${PEER_NODE_NAME.toUpperCase()}`,
        mirror: {
            name: 'ENTITIES',
            external: { api: `$JS.${PEER_NODE_NAME}.API` },
        },
        max_msgs: 10000,
    }, `[Bridge ${NODE_NAME}] Created JetStream mirror MIRROR_ENTITIES_${PEER_NODE_NAME.toUpperCase()} (Peer: ${PEER_NODE_NAME}).`);

    await ensureStream(jsm, 'MISSIONS', {
        name: 'MISSIONS',
        subjects: [`mission.lifecycle.${NODE_NAME}.>`],
        duplicate_window: 5000000000,
        max_msgs: 10000,
    }, `[Bridge ${NODE_NAME}] Created/Updated local JetStream MISSIONS.`);

    await ensureStream(jsm, `MIRROR_MISSIONS_${PEER_NODE_NAME.toUpperCase()}`, {
        name: `MIRROR_MISSIONS_${PEER_NODE_NAME.toUpperCase()}`,
        mirror: {
            name: 'MISSIONS',
            external: { api: `$JS.${PEER_NODE_NAME}.API` },
        },
        max_msgs: 10000,
    }, `[Bridge ${NODE_NAME}] Created JetStream mirror MIRROR_MISSIONS_${PEER_NODE_NAME.toUpperCase()} (Peer: ${PEER_NODE_NAME}).`);

    const pgClient = new Client({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
    });
    await pgClient.connect();
    console.log(`[Bridge ${NODE_NAME}] Connected to Postgres.`);

    pgClient.on('notification', async (msg) => {
        if (!msg.payload) {
            return;
        }

        try {
            if (msg.channel === 'entity_changes') {
                const rawPayload = JSON.parse(msg.payload) as Omit<EntityDelta, 'type'>;
                if (!rawPayload.mission_id || typeof rawPayload.last_change_seq !== 'number') {
                    return;
                }

                const payload: EntityDelta = {
                    type: 'changed',
                    mission_id: rawPayload.mission_id,
                    last_change_seq: rawPayload.last_change_seq,
                    origin_node: rawPayload.origin_node,
                };

                await js.publish(ENTITY_DELTA_SUBJECT, sc.encode(JSON.stringify(payload)), {
                    msgID: `${payload.mission_id}-${payload.last_change_seq}`,
                });
                console.log(`[Bridge ${NODE_NAME}] Published mission pulse for ${payload.mission_id} seq ${payload.last_change_seq}`);
                return;
            }

            if (msg.channel === 'mission_changes') {
                const payload = JSON.parse(msg.payload);
                if (payload.deleted_at) {
                    return;
                }

                const missionEvent = {
                    id: payload.id,
                    name: payload.name,
                    created_at: payload.created_at,
                    node: NODE_NAME,
                    timestamp: new Date().toISOString(),
                };

                await js.publish(MISSION_DELTA_SUBJECT, sc.encode(JSON.stringify(missionEvent)), {
                    msgID: `mission-${payload.id}`,
                });
                console.log(`[Bridge ${NODE_NAME}] Published mission update for ${payload.id}`);
            }
        } catch (err) {
            console.error(`[Bridge ${NODE_NAME}] Error processing ${msg.channel}:`, err);
        }
    });

    await pgClient.query('LISTEN entity_changes');
    await pgClient.query('LISTEN mission_changes');
    console.log(`[Bridge ${NODE_NAME}] Listening for entity_changes and mission_changes...`);

    process.on('SIGINT', async () => {
        await pgClient.end();
        await nc.close();
        process.exit(0);
    });
}

startBridge().catch(err => {
    console.error(`[Bridge ${NODE_NAME}] Fatal Error:`, err);
    process.exit(1);
});
