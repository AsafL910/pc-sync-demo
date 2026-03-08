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
const MAX_PAYLOAD_SIZE = 500 * 1024;

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
                const payload = JSON.parse(msg.payload);
                const { entity_id, version, mission_id } = payload;
                const msgId = `${entity_id}-${version}`;
                const payloadStr = JSON.stringify(payload);
                const sizeBytes = Buffer.byteLength(payloadStr, 'utf8');

                let delta: EntityDelta;

                if (sizeBytes > MAX_PAYLOAD_SIZE) {
                    delta = {
                        type: 'reload',
                        mission_id,
                    };
                } else {
                    const res = await pgClient.query(`
                        SELECT 
                            entity_id,
                            mission_id,
                            entity_type,
                            ST_AsGeoJSON(geom)::jsonb as geometry,
                            properties,
                            version,
                            schema_version,
                            origin_node
                        FROM v_map_render_layer
                        WHERE entity_id = $1
                    `, [entity_id]);

                    if (res.rows.length === 0) {
                        return;
                    }

                    const row = res.rows[0];
                    delta = {
                        type: 'update',
                        mission_id: row.mission_id,
                        entity_id: row.entity_id,
                        entity_type: row.entity_type,
                        geometry: row.geometry,
                        properties: row.properties,
                        version: row.version,
                        schema_version: row.schema_version,
                        origin_node: row.origin_node,
                    };
                }

                await js.publish(ENTITY_DELTA_SUBJECT, sc.encode(JSON.stringify(delta)), { msgID: msgId });
                console.log(`[Bridge ${NODE_NAME}] Published entity delta ${delta.type} for ${entity_id} v${version}`);
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
