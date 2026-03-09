import pg from 'pg';
const { Pool } = pg;

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
      CREATE TABLE IF NOT EXISTS missions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          last_change_seq BIGINT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          deleted_at TIMESTAMPTZ
      );
    `);

        await client.query(`
      CREATE TABLE IF NOT EXISTS infra (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          last_change_seq BIGINT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          deleted_at TIMESTAMPTZ
      );
    `);

        await client.query(`
      CREATE TABLE IF NOT EXISTS entities (
          entity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          mission_id UUID REFERENCES missions(id),
          infra_id UUID REFERENCES infra(id),
          parent_entity_id UUID REFERENCES entities(entity_id),

          entity_type TEXT NOT NULL,
          geom GEOMETRY(Geometry, 4326),
          properties JSONB DEFAULT '{}',

          version BIGINT DEFAULT 1,
          schema_version INT DEFAULT 1,
          is_deleted BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          origin_node VARCHAR(100) DEFAULT '${NODE_NAME}',

          CONSTRAINT belongs_to_one CHECK (
              (mission_id IS NOT NULL AND infra_id IS NULL) OR
              (mission_id IS NULL AND infra_id IS NOT NULL)
          ),

          CONSTRAINT enforce_spatial_integrity CHECK (
              (entity_type IN ('point', 'circle') AND ST_GeometryType(geom) = 'ST_Point') OR
              (entity_type = 'polygon' AND ST_GeometryType(geom) IN ('ST_Polygon', 'ST_MultiPolygon')) OR
              (entity_type = 'linestring' AND ST_GeometryType(geom) IN ('ST_LineString', 'ST_MultiLineString'))
          )
      );
    `);

        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_spatial_entities ON entities USING GIST (geom);
    `);

        const DEFAULT_MISSION_ID = '00000000-0000-0000-0000-000000000001';
        await client.query(`
            INSERT INTO missions (id, name)
            VALUES ($1, 'Default Operations')
            ON CONFLICT (id) DO NOTHING;
        `, [DEFAULT_MISSION_ID]);

        await client.query(`
      CREATE OR REPLACE FUNCTION bump_mission_seq() RETURNS trigger AS $$
      DECLARE
        target_id UUID;
      BEGIN
        -- Derived state: compute once on the writer and replicate the result
        -- as row data. Replica apply should not re-run this logic.
        target_id := COALESCE(NEW.mission_id, OLD.mission_id);
        IF target_id IS NOT NULL THEN
          UPDATE missions SET last_change_seq = last_change_seq + 1 WHERE id = target_id;
        END IF;
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_entities_mission_seq ON entities;
      CREATE TRIGGER trg_entities_mission_seq
      AFTER INSERT OR UPDATE OR DELETE ON entities
      FOR EACH ROW
      EXECUTE FUNCTION bump_mission_seq();

      CREATE OR REPLACE FUNCTION bump_infra_seq() RETURNS trigger AS $$
      DECLARE
        target_id UUID;
      BEGIN
        -- Derived state: compute once on the writer and replicate the result
        -- as row data. Replica apply should not re-run this logic.
        target_id := COALESCE(NEW.infra_id, OLD.infra_id);
        IF target_id IS NOT NULL THEN
          UPDATE infra SET last_change_seq = last_change_seq + 1 WHERE id = target_id;
        END IF;
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_entities_infra_seq ON entities;
      CREATE TRIGGER trg_entities_infra_seq
      AFTER INSERT OR UPDATE OR DELETE ON entities
      FOR EACH ROW
      EXECUTE FUNCTION bump_infra_seq();

      CREATE OR REPLACE FUNCTION bump_entity_version() RETURNS trigger AS $$
      BEGIN
        -- Version is writer-derived state. Accept the replicated value on
        -- peer nodes instead of incrementing again during replica apply.
        NEW.version = OLD.version + 1;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_entities_version ON entities;
      CREATE TRIGGER trg_entities_version
      BEFORE UPDATE ON entities
      FOR EACH ROW
      EXECUTE FUNCTION bump_entity_version();

      CREATE OR REPLACE FUNCTION notify_entity_change() RETURNS trigger AS $$
      DECLARE
        payload TEXT;
        r RECORD;
      BEGIN
        -- Notifications are side effects. These should be replayed on replica
        -- apply so the local bridge can emit local deltas.
        r := COALESCE(NEW, OLD);
        payload := json_build_object(
          'entity_id', r.entity_id,
          'version', r.version,
          'mission_id', r.mission_id,
          'infra_id', r.infra_id,
          'origin_node', r.origin_node
        )::text;
        PERFORM pg_notify('entity_changes', payload);
        RETURN r;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_entities_notify ON entities;
      CREATE TRIGGER trg_entities_notify
      AFTER INSERT OR UPDATE ON entities
      FOR EACH ROW
      EXECUTE FUNCTION notify_entity_change();

      CREATE OR REPLACE FUNCTION notify_mission_change() RETURNS trigger AS $mission$
      DECLARE
        payload TEXT;
        r RECORD;
        op TEXT;
      BEGIN
        -- Suppress heartbeat-only updates. last_change_seq is replicated state,
        -- but mission lifecycle notifications should only describe meaningful
        -- lifecycle changes such as create, rename, or delete.
        IF TG_OP = 'UPDATE'
           AND NEW.name IS NOT DISTINCT FROM OLD.name
           AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
          RETURN NEW;
        END IF;

        r := COALESCE(NEW, OLD);
        op := CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END;
        payload := json_build_object(
          'id', r.id,
          'name', r.name,
          'created_at', r.created_at,
          'deleted_at', r.deleted_at,
          'operation', op
        )::text;
        PERFORM pg_notify('mission_changes', payload);
        RETURN r;
      END;
      $mission$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_missions_notify ON missions;
      CREATE TRIGGER trg_missions_notify
      AFTER INSERT OR UPDATE ON missions
      FOR EACH ROW
      EXECUTE FUNCTION notify_mission_change();

      ALTER TABLE entities ENABLE TRIGGER trg_entities_mission_seq;
      ALTER TABLE entities ENABLE TRIGGER trg_entities_infra_seq;
      ALTER TABLE entities ENABLE TRIGGER trg_entities_version;
      ALTER TABLE entities ENABLE ALWAYS TRIGGER trg_entities_notify;
      ALTER TABLE missions ENABLE ALWAYS TRIGGER trg_missions_notify;
    `);

        await client.query(`DROP VIEW IF EXISTS v_map_render_layer;`);
        await client.query(`DROP VIEW IF EXISTS v_active_entities;`);

        await client.query(`
      CREATE VIEW v_active_entities AS
      SELECT e.*
      FROM entities e
      LEFT JOIN missions m ON e.mission_id = m.id
      LEFT JOIN infra i ON e.infra_id = i.id
      WHERE (m.deleted_at IS NULL OR e.mission_id IS NULL)
        AND (i.deleted_at IS NULL OR e.infra_id IS NULL)
        AND e.is_deleted = false;
    `);

        await client.query(`
      CREATE VIEW v_map_render_layer AS
      SELECT
        entity_id,
        mission_id,
        entity_type,
        geom,
        jsonb_set(
            properties,
            '{opacity}',
            COALESCE(properties->'opacity', '1.0'::jsonb)
        ) as properties,
        version,
        schema_version,
        origin_node
      FROM v_active_entities;
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

        const tables = ['missions', 'infra', 'entities'];
        for (const table of tables) {
            try {
                await client.query(
                    `SELECT pglogical.replication_set_add_table(
              set_name := 'mesh_replication',
              relation := $1,
              synchronize_data := true
            )`, [table]
                );
                console.log(`[${NODE_NAME}] Table ${table} added to replication set`);
            } catch (e: any) {
                if (e.message.includes('already') || e.message.includes('duplicate')) {
                    console.log(`[${NODE_NAME}] Table ${table} already in replication set`);
                } else {
                    throw e;
                }
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

            const statusResult = await client.query(
                `SELECT subscription_name, status
                 FROM pglogical.show_subscription_status()
                 WHERE subscription_name = $1`,
                [subName]
            ).catch(() => ({ rows: [] as Array<{ subscription_name: string; status: string }> }));

            const currentStatus = statusResult.rows[0]?.status;
            if (currentStatus === 'down') {
                console.log(`[${NODE_NAME}] Subscription ${subName} is down, dropping and recreating it`);
                await client.query(`SELECT pglogical.drop_subscription($1, true)`, [subName]).catch((e: any) => {
                    console.log(`[${NODE_NAME}] Drop subscription note: ${e.message}`);
                });
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
                        synchronize_data := false,
                        forward_origins := '{}',
                        apply_delay := '0 seconds'::interval
                    )`,
                    [subName, peerDsn]
                );
                console.log(`[${NODE_NAME}] Subscription to ${PEER_NODE_NAME} created successfully`);
            }

            const verifyStatus = await client.query(
                `SELECT status
                 FROM pglogical.show_subscription_status()
                 WHERE subscription_name = $1`,
                [subName]
            ).catch(() => ({ rows: [] as Array<{ status: string }> }));

            const status = verifyStatus.rows[0]?.status;
            if (!status || status === 'down') {
                console.log(`[${NODE_NAME}] Subscription ${subName} is not healthy yet (status: ${status || 'unknown'})`);
                return false;
            }

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

export async function getMissions() {
    const result = await pool.query(`SELECT id, name, created_at FROM missions ORDER BY created_at DESC`);
    return result.rows;
}

export async function getActiveEntities(missionId: string) {
    const result = await pool.query(`
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
        WHERE mission_id = $1
    `, [missionId]);
    return result.rows;
}

export async function getMapRenderLayer(missionId: string) {
    const result = await pool.query(`
        SELECT
            entity_id,
            mission_id,
            entity_type,
            ST_AsGeoJSON(geom)::jsonb as geometry,
            properties,
            version,
            schema_version
        FROM v_map_render_layer
        WHERE mission_id = $1
    `, [missionId]);
    return result.rows;
}

export async function insertRandomEntity(missionId: string) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const missionCheck = await client.query(
            `SELECT id FROM missions WHERE id = $1 AND deleted_at IS NULL`,
            [missionId]
        );
        if (missionCheck.rows.length === 0) {
            throw new Error('Mission not found');
        }

        const lat = 31.5 + Math.random();
        const lng = 34.5 + Math.random();
        const types = ['point', 'polygon', 'linestring'];
        const entityType = types[Math.floor(Math.random() * types.length)];
        let geomStr = `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;
        if (entityType === 'polygon') {
            geomStr = `ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(${lng} ${lat}, ${lng + 0.01} ${lat}, ${lng + 0.01} ${lat + 0.01}, ${lng} ${lat + 0.01}, ${lng} ${lat})')), 4326)`;
        } else if (entityType === 'linestring') {
            geomStr = `ST_SetSRID(ST_GeomFromText('LINESTRING(${lng} ${lat}, ${lng + 0.01} ${lat + 0.01})'), 4326)`;
        }

        const res = await client.query(`
            INSERT INTO entities(mission_id, entity_type, geom, properties)
            VALUES ($1, $2, ${geomStr}, $3)
            RETURNING entity_id
        `, [
            missionId,
            entityType,
            JSON.stringify({
                color: ['#3b82f6', '#10b981', '#ef4444', '#f59e0b'][Math.floor(Math.random() * 4)],
                opacity: 0.8
            })
        ]);

        await client.query('COMMIT');
        return { mission_id: missionId, entity_id: res.rows[0].entity_id };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

export async function createMission(name: string) {
    const result = await pool.query(
        `INSERT INTO missions (name) VALUES ($1) RETURNING id, name, created_at`,
        [name]
    );
    return result.rows[0];
}

