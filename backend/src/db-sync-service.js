/**
 * DB Sync Service
 * - Creates schema (point_polygon_relations table + active_relations view)
 * - Sets up pglogical bi-directional replication
 * - Exposes REST API for relations
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const NODE_NAME = process.env.NODE_NAME || 'node_a';
const PEER_NODE_NAME = process.env.PEER_NODE_NAME || 'node_b';
const PEER_DB_HOST = process.env.PEER_DB_HOST || 'postgres_b';
const PEER_DB_PORT = process.env.PEER_DB_PORT || '5432';
const DB_USER = process.env.DB_USER || 'mesh';
const DB_PASS = process.env.DB_PASS || 'mesh_pass';
const DB_NAME = process.env.DB_NAME || 'meshdb';
const PORT = parseInt(process.env.PORT || '3000', 10);

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    max: 5,
});

// ---- Schema Setup ----
async function createSchema() {
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

        // View: resolve current state (latest event per relation_id)
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

// ---- pglogical Setup ----
async function setupPglogical() {
    const client = await pool.connect();
    try {
        // Create pglogical node
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

        // Create replication set
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
        } catch (e) {
            if (e.message.includes('already exists')) {
                console.log(`[${NODE_NAME}] Replication set already exists`);
            } else {
                throw e;
            }
        }

        // Add table to replication set
        try {
            await client.query(
                `SELECT pglogical.replication_set_add_table(
          set_name := 'mesh_replication',
          relation := 'point_polygon_relations',
          synchronize_data := true
        )`
            );
            console.log(`[${NODE_NAME}] Table added to replication set`);
        } catch (e) {
            if (e.message.includes('already') || e.message.includes('duplicate')) {
                console.log(`[${NODE_NAME}] Table already in replication set`);
            } else {
                throw e;
            }
        }

        // Subscribe to peer node (with retry loop as peer might not be up)
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

            // 1. Check if node ready locally
            const nodeInfo = await client.query(`SELECT 1 FROM pglogical.node WHERE node_name = $1`, [NODE_NAME]);
            if (nodeInfo.rows.length === 0) {
                console.log(`[${NODE_NAME}] Local pglogical node not ready yet, skipping sub attempt`);
                return false;
            }

            // 2. Check if subscription exists
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

            // 3. Ensure conflict resolver
            await client.query(
                `SELECT pglogical.alter_subscription_set_conflict_resolver($1::name, $2::name)`,
                [subName, 'last_update_wins']
            ).catch(e => {
                console.log(`[${NODE_NAME}] Conflict resolver update note: ${e.message}`);
                // Not fatal if it's already set or fails temporarily
            });

            return true;
        } catch (e) {
            console.error(`[${NODE_NAME}] Subscription attempt error:`, e.message);
            if (e.detail) console.error(`[${NODE_NAME}] Error detail:`, e.detail);
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

// ---- Express App ----
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', node: NODE_NAME, service: 'db-sync' });
});

// POST /relations - Insert a new relation event
app.post('/relations', async (req, res) => {
    try {
        const {
            relation_id = uuidv4(),
            point_id,
            polygon_id,
            status = 'connected',
            metadata = {}
        } = req.body;

        const result = await pool.query(
            `INSERT INTO point_polygon_relations (relation_id, point_id, polygon_id, status, metadata, origin_node)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
            [relation_id, point_id, polygon_id, status, JSON.stringify(metadata), NODE_NAME]
        );

        console.log(`[${NODE_NAME}] Inserted relation: ${relation_id}`);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(`[${NODE_NAME}] Insert error:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /relations - Query active relations view
app.get('/relations', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM active_relations ORDER BY created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error(`[${NODE_NAME}] Query error:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /relations/all - Query all events (raw append-only log)
app.get('/relations/all', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM point_polygon_relations ORDER BY created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error(`[${NODE_NAME}] Query error:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// ---- Startup ----
async function start() {
    try {
        await createSchema();
        console.log(`[${NODE_NAME}] Waiting 5s for peer database to be ready...`);
        await new Promise(r => setTimeout(r, 5000));
        await setupPglogical();
    } catch (err) {
        console.error(`[${NODE_NAME}] Setup error:`, err.message);
        console.log(`[${NODE_NAME}] Will retry pglogical setup in 10s...`);
        setTimeout(async () => {
            try { await setupPglogical(); } catch (e) {
                console.error(`[${NODE_NAME}] pglogical retry failed:`, e.message);
            }
        }, 10000);
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`[${NODE_NAME}] DB Sync Service listening on port ${PORT}`);
    });
}

start();
