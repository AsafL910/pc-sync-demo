import pg from 'pg';
const { Pool } = pg;
import { MissionRelation } from '../shared/types.js';

const NODE_NAME = process.env.NODE_NAME || 'node_a';
const PEER_NODE_NAME = process.env.PEER_NODE_NAME || 'node_b';
const PEER_DB_HOST = process.env.PEER_DB_HOST || 'postgres_b';
const PEER_DB_PORT = process.env.PEER_DB_PORT || '5432';
const DB_USER = process.env.DB_USER || 'mesh';
const DB_PASS = process.env.DB_PASS || 'mesh_pass';
const DB_NAME = process.env.DB_NAME || 'meshdb';

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    max: 5,
});

export async function createSchema() {
    const client = await pool.connect();
    try {
        await client.query(`
      CREATE TABLE IF NOT EXISTS point_polygon_relations (
        id UUID DEFAULT gen_random_uuid(),
        relation_id UUID NOT NULL,
        point_id VARCHAR(255) NOT NULL,
        polygon_id VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('connected', 'disconnected')),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        origin_node VARCHAR(100) DEFAULT '${NODE_NAME}',
        PRIMARY KEY (id)
      );
    `);

        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ppr_relation_id ON point_polygon_relations(relation_id);
    `);

        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ppr_created_at ON point_polygon_relations(created_at);
    `);

        await client.query(`
      CREATE OR REPLACE VIEW active_relations AS
      SELECT DISTINCT ON (relation_id)
        id,
        relation_id,
        point_id,
        polygon_id,
        status,
        metadata,
        created_at,
        origin_node
      FROM point_polygon_relations
      ORDER BY relation_id, created_at DESC;
    `);

        console.log(`[${NODE_NAME}] Schema created successfully`);
    } finally {
        client.release();
    }
}

export async function setupPglogical() {
    const client = await pool.connect();
    try {
        const nodeExists = await client.query(
            `SELECT 1 FROM pglogical.node WHERE node_name = $1`, [NODE_NAME]
        );

        if (nodeExists.rows.length === 0) {
            const dsn = `host=${process.env.DB_HOST} port=${process.env.DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${DB_PASS}`;
            await client.query(
                `SELECT pglogical.create_node(node_name := $1, dsn := $2)`,
                [NODE_NAME, dsn]
            );
            console.log(`[${NODE_NAME}] pglogical node created`);
        }

        try {
            await client.query(
                `SELECT pglogical.create_replication_set(
          set_name := 'mesh_replication',
          replicate_insert := true,
          replicate_update := true,
          replicate_delete := true,
          replicate_truncate := true
        )`
            );
            console.log(`[${NODE_NAME}] Replication set created`);
        } catch (e: any) {
            if (e.message.includes('already exists')) {
                console.log(`[${NODE_NAME}] Replication set already exists`);
            } else {
                throw e;
            }
        }

        try {
            await client.query(
                `SELECT pglogical.replication_set_add_table(
          set_name := 'mesh_replication',
          relation := 'point_polygon_relations',
          synchronize_data := true
        )`
            );
            console.log(`[${NODE_NAME}] Table added to replication set`);
        } catch (e: any) {
            if (e.message.includes('already') || e.message.includes('duplicate')) {
                console.log(`[${NODE_NAME}] Table already in replication set`);
            } else {
                throw e;
            }
        }

        await ensureSubscription();

        console.log(`[${NODE_NAME}] pglogical setup process initiated`);
    } finally {
        client.release();
    }
}

async function ensureSubscription() {
    const subName = `sub_${NODE_NAME}_to_${PEER_NODE_NAME}`;

    const attempt = async () => {
        let client;
        try {
            client = await pool.connect();
            const nodeInfo = await client.query(`SELECT 1 FROM pglogical.node WHERE node_name = $1`, [NODE_NAME]);
            if (nodeInfo.rows.length === 0) {
                console.log(`[${NODE_NAME}] Local pglogical node not ready yet, skipping sub attempt`);
                return false;
            }

            const subExists = await client.query(
                `SELECT 1 FROM pglogical.subscription WHERE sub_name = $1`,
                [subName]
            );

            if (subExists.rows.length === 0) {
                const peerDsn = `host=${PEER_DB_HOST} port=${PEER_DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${DB_PASS}`;
                console.log(`[${NODE_NAME}] Attempting to create subscription to: ${peerDsn}`);

                await client.query(
                    `SELECT pglogical.create_subscription(
                        subscription_name := $1,
                        provider_dsn := $2,
                        replication_sets := ARRAY['mesh_replication'],
                        synchronize_data := true,
                        forward_origins := '{}',
                        apply_delay := '0 seconds'::interval
                    )`,
                    [subName, peerDsn]
                );
                console.log(`[${NODE_NAME}] Subscription to ${PEER_NODE_NAME} created successfully`);
            }

            await client.query(
                `SELECT pglogical.alter_subscription_set_conflict_resolver($1::name, $2::name)`,
                [subName, 'last_update_wins']
            ).catch(e => {
                console.log(`[${NODE_NAME}] Conflict resolver update note: ${e.message}`);
            });

            return true;
        } catch (e: any) {
            console.error(`[${NODE_NAME}] Subscription attempt error:`, e.message);
            return false;
        } finally {
            if (client) client.release();
        }
    };

    const success = await attempt();
    if (!success) {
        console.log(`[${NODE_NAME}] pglogical will retry subscription every 15s...`);
        const retryInterval = setInterval(async () => {
            if (await attempt()) {
                console.log(`[${NODE_NAME}] pglogical subscription established!`);
                clearInterval(retryInterval);
            }
        }, 15000);
    } else {
        console.log(`[${NODE_NAME}] pglogical subscription verified`);
    }
}

export async function insertRelation(relation: Omit<MissionRelation, 'id' | 'created_at' | 'origin_node'>) {
    const result = await pool.query(
        `INSERT INTO point_polygon_relations (relation_id, point_id, polygon_id, status, metadata, origin_node)
   VALUES ($1, $2, $3, $4, $5, $6)
   RETURNING *`,
        [relation.relation_id, relation.point_id, relation.polygon_id, relation.status, JSON.stringify(relation.metadata), NODE_NAME]
    );
    return result.rows[0];
}

export async function getActiveRelations() {
    const result = await pool.query(`SELECT * FROM active_relations ORDER BY created_at DESC`);
    return result.rows;
}

export async function getAllRelations() {
    const result = await pool.query(`SELECT * FROM point_polygon_relations ORDER BY created_at DESC`);
    return result.rows;
}
