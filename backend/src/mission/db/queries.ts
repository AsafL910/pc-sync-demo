import { missionPool } from "./pool.js";

export interface MissionSummaryRow {
    id: string;
    name: string;
    created_at: string;
}

export interface EntityRenderRow {
    entity_id: string;
    mission_id: string;
    entity_type: string;
    geometry: unknown;
    properties: Record<string, unknown>;
    version: number;
    mission_change_seq: number;
    schema_version: number;
    origin_node?: string;
}

export interface EntityDeltaRow {
    entity_id: string;
    mission_id: string;
    entity_type: string;
    geometry: unknown | null;
    properties: Record<string, unknown>;
    version: number;
    mission_change_seq: number;
    schema_version: number;
    origin_node?: string;
    is_deleted: boolean;
}

const entityProjection = `
    entity_id,
    mission_id,
    entity_type,
    ST_AsGeoJSON(geom)::jsonb as geometry,
    properties,
    version,
    mission_change_seq,
    schema_version
`;

export async function getMissions(): Promise<MissionSummaryRow[]> {
    const result = await missionPool.query<MissionSummaryRow>(
        "SELECT id, name, created_at FROM missions ORDER BY created_at DESC",
    );
    return result.rows;
}

export async function getActiveEntities(missionId: string): Promise<EntityRenderRow[]> {
    const result = await missionPool.query<EntityRenderRow>(
        `
            SELECT
                ${entityProjection},
                origin_node
            FROM v_map_render_layer
            WHERE mission_id = $1
            ORDER BY mission_change_seq ASC, entity_id ASC
        `,
        [missionId],
    );
    return result.rows;
}

export async function getMapRenderLayer(missionId: string): Promise<EntityRenderRow[]> {
    const result = await missionPool.query<EntityRenderRow>(
        `
            SELECT
                ${entityProjection}
            FROM v_map_render_layer
            WHERE mission_id = $1
            ORDER BY mission_change_seq ASC, entity_id ASC
        `,
        [missionId],
    );
    return result.rows;
}

export async function getEntityDeltaSince(missionId: string, sinceSeq: number): Promise<EntityDeltaRow[]> {
    const result = await missionPool.query<EntityDeltaRow>(
        `
            SELECT
                e.entity_id,
                e.mission_id,
                e.entity_type,
                CASE WHEN e.is_deleted THEN NULL ELSE ST_AsGeoJSON(e.geom)::jsonb END AS geometry,
                e.properties,
                e.version,
                e.mission_change_seq,
                e.schema_version,
                e.origin_node,
                e.is_deleted
            FROM entities e
            LEFT JOIN missions m ON e.mission_id = m.id
            WHERE e.mission_id = $1
              AND e.mission_change_seq > $2
              AND (m.deleted_at IS NULL OR e.is_deleted = true)
            ORDER BY e.mission_change_seq ASC, e.entity_id ASC
        `,
        [missionId, sinceSeq],
    );
    return result.rows;
}
