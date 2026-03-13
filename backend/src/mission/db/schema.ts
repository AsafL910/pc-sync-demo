import { PoolClient } from "pg";
import { missionDbConfig } from "./config.js";
import { withTransaction } from "./pool.js";


const bootstrapStatements = [
  "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
  `
      CREATE TABLE IF NOT EXISTS missions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          last_change_seq BIGINT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          deleted_at TIMESTAMPTZ
      );
    `,
  `
      CREATE TABLE IF NOT EXISTS infra (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          last_change_seq BIGINT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          deleted_at TIMESTAMPTZ
      );
    `,
  `
      CREATE TABLE IF NOT EXISTS active_mission (
          id INT PRIMARY KEY CHECK (id = 1),
          mission_id UUID REFERENCES missions(id) ON DELETE SET NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  `
      CREATE TABLE IF NOT EXISTS entities (
          entity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          mission_id UUID REFERENCES missions(id),
          infra_id UUID REFERENCES infra(id),
          parent_entity_id UUID REFERENCES entities(entity_id),
          entity_type TEXT NOT NULL,
          geom GEOMETRY(Geometry, 4326),
          properties JSONB NOT NULL DEFAULT '{}',
          version BIGINT NOT NULL DEFAULT 1,
          mission_change_seq BIGINT NOT NULL DEFAULT 0,
          schema_version INT NOT NULL DEFAULT 1,
          is_deleted BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          origin_node VARCHAR(100) NOT NULL DEFAULT '${missionDbConfig.nodeName}',
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
    `,
  "ALTER TABLE entities ADD COLUMN IF NOT EXISTS mission_change_seq BIGINT NOT NULL DEFAULT 0;",
  "CREATE INDEX IF NOT EXISTS idx_spatial_entities ON entities USING GIST (geom);",
  `
      CREATE OR REPLACE FUNCTION assign_entity_change_metadata() RETURNS trigger AS $$
      DECLARE
        target_mission_id UUID;
        next_seq BIGINT;
      BEGIN
        target_mission_id := COALESCE(NEW.mission_id, OLD.mission_id);

        IF target_mission_id IS NOT NULL THEN
          UPDATE missions
          SET last_change_seq = last_change_seq + 1
          WHERE id = target_mission_id
          RETURNING last_change_seq INTO next_seq;

          NEW.mission_change_seq := COALESCE(next_seq, NEW.mission_change_seq, 0);
        END IF;

        IF TG_OP = 'UPDATE' THEN
          NEW.version := OLD.version + 1;
        ELSE
          NEW.version := COALESCE(NEW.version, 1);
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_entities_assign_change_metadata ON entities;
      CREATE TRIGGER trg_entities_assign_change_metadata
      BEFORE INSERT OR UPDATE ON entities
      FOR EACH ROW
      EXECUTE FUNCTION assign_entity_change_metadata();
    `,
  `
      CREATE OR REPLACE FUNCTION bump_infra_seq() RETURNS trigger AS $$
      DECLARE
        target_id UUID;
      BEGIN
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
    `,
  `
      CREATE OR REPLACE FUNCTION notify_entity_change() RETURNS trigger AS $$
      DECLARE
        payload TEXT;
        row_data RECORD;
      BEGIN
        row_data := COALESCE(NEW, OLD);
        payload := json_build_object(
          'type', 'changed',
          'mission_id', row_data.mission_id,
          'entity_id', row_data.entity_id,
          'version', row_data.version,
          'last_change_seq', row_data.mission_change_seq,
          'origin_node', row_data.origin_node
        )::text;
        PERFORM pg_notify('entity_changes', payload);
        RETURN row_data;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_entities_notify ON entities;
      CREATE TRIGGER trg_entities_notify
      AFTER INSERT OR UPDATE ON entities
      FOR EACH ROW
      EXECUTE FUNCTION notify_entity_change();
    `,
  `
      CREATE OR REPLACE FUNCTION notify_mission_change() RETURNS trigger AS $mission$
      DECLARE
        payload TEXT;
        row_data RECORD;
        operation TEXT;
      BEGIN
        IF TG_OP = 'UPDATE'
           AND NEW.name IS NOT DISTINCT FROM OLD.name
           AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
          RETURN NEW;
        END IF;

        row_data := COALESCE(NEW, OLD);
        operation := CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END;
        payload := json_build_object(
          'id', row_data.id,
          'name', row_data.name,
          'created_at', row_data.created_at,
          'deleted_at', row_data.deleted_at,
          'operation', operation
        )::text;
        PERFORM pg_notify('mission_changes', payload);
        RETURN row_data;
      END;
      $mission$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_missions_notify ON missions;
      CREATE TRIGGER trg_missions_notify
      AFTER INSERT OR UPDATE ON missions
      FOR EACH ROW
      EXECUTE FUNCTION notify_mission_change();

      ALTER TABLE missions ENABLE ALWAYS TRIGGER trg_missions_notify;

      ALTER TABLE entities ENABLE TRIGGER trg_entities_assign_change_metadata;
      ALTER TABLE entities ENABLE TRIGGER trg_entities_infra_seq;
      ALTER TABLE entities ENABLE ALWAYS TRIGGER trg_entities_notify;
    `,
  `
      CREATE OR REPLACE FUNCTION notify_active_mission_change() RETURNS trigger AS $$
      DECLARE
        payload TEXT;
      BEGIN
        IF TG_OP = 'UPDATE' AND NEW.mission_id IS NOT DISTINCT FROM OLD.mission_id THEN
          RETURN NEW;
        END IF;

        payload := json_build_object(
          'type', 'active_mission_changed',
          'mission_id', NEW.mission_id,
          'timestamp', NEW.updated_at
        )::text;
        PERFORM pg_notify('active_mission_changes', payload);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_active_mission_notify ON active_mission;
      CREATE TRIGGER trg_active_mission_notify
      AFTER INSERT OR UPDATE ON active_mission
      FOR EACH ROW
      EXECUTE FUNCTION notify_active_mission_change();
      
      ALTER TABLE active_mission ENABLE ALWAYS TRIGGER trg_active_mission_notify;
    `,
  "DROP VIEW IF EXISTS v_map_render_layer;",
  "DROP VIEW IF EXISTS v_active_entities;",
  `
      CREATE VIEW v_active_entities AS
      SELECT e.*
      FROM entities e
      LEFT JOIN missions m ON e.mission_id = m.id
      LEFT JOIN infra i ON e.infra_id = i.id
      WHERE (m.deleted_at IS NULL OR e.mission_id IS NULL)
        AND (i.deleted_at IS NULL OR e.infra_id IS NULL)
        AND e.is_deleted = false;
    `,
  `
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
        ) AS properties,
        version,
        mission_change_seq,
        schema_version,
        origin_node
      FROM v_active_entities;
    `,
];

async function executeBootstrapStatement(client: PoolClient, statement: string): Promise<void> {
  await client.query(statement);
}

export async function createSchema(): Promise<void> {
  await withTransaction(async (client) => {
    for (const statement of bootstrapStatements) {
      await executeBootstrapStatement(client, statement);
    }
  });

  console.log(`[${missionDbConfig.nodeName}] Schema created successfully`);
}
