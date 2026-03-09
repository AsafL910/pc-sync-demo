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
    schema_version: number;
    origin_node?: string;
}

const entityProjection = `
    entity_id,
    mission_id,
    entity_type,
    ST_AsGeoJSON(geom)::jsonb as geometry,
    properties,
    version,
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
        `,
        [missionId],
    );
    return result.rows;
}
