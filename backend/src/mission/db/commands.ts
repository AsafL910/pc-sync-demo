import { withTransaction } from "./pool.js";

export class MissionValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MissionValidationError";
    }
}

export class MissionNotFoundError extends Error {
    constructor(missionId: string) {
        super(`Mission not found: ${missionId}`);
        this.name = "MissionNotFoundError";
    }
}

export interface CreatedMission {
    id: string;
    name: string;
    created_at: string;
}

export interface CreatedEntity {
    mission_id: string;
    entity_id: string;
}

type GeometryType = "point" | "polygon" | "linestring";

interface GeometrySeed {
    entityType: GeometryType;
    wkt: string;
}

function normalizeMissionName(name: string): string {
    const normalized = name.trim();
    if (!normalized) {
        throw new MissionValidationError("Mission name cannot be empty");
    }

    if (normalized.length > 120) {
        throw new MissionValidationError("Mission name must be 120 characters or fewer");
    }

    return normalized;
}

function createRandomGeometry(): GeometrySeed {
    const lat = 31.5 + Math.random();
    const lng = 34.5 + Math.random();
    const types: GeometryType[] = ["point", "polygon", "linestring"];
    const entityType = types[Math.floor(Math.random() * types.length)];

    if (entityType === "polygon") {
        const wkt = `POLYGON((${lng} ${lat}, ${lng + 0.01} ${lat}, ${lng + 0.01} ${lat + 0.01}, ${lng} ${lat + 0.01}, ${lng} ${lat}))`;
        return { entityType, wkt };
    }

    if (entityType === "linestring") {
        const wkt = `LINESTRING(${lng} ${lat}, ${lng + 0.01} ${lat + 0.01})`;
        return { entityType, wkt };
    }

    return {
        entityType,
        wkt: `POINT(${lng} ${lat})`,
    };
}

export async function createMission(name: string): Promise<CreatedMission> {
    const normalizedName = normalizeMissionName(name);

    return withTransaction(async (client) => {
        const result = await client.query<CreatedMission>(
            "INSERT INTO missions (name) VALUES ($1) RETURNING id, name, created_at",
            [normalizedName],
        );
        return result.rows[0];
    });
}

export async function insertRandomEntity(missionId: string): Promise<CreatedEntity> {
    const normalizedMissionId = missionId.trim();
    if (!normalizedMissionId) {
        throw new MissionValidationError("mission_id is required");
    }

    return withTransaction(async (client) => {
        const missionCheck = await client.query(
            "SELECT id FROM missions WHERE id = $1 AND deleted_at IS NULL",
            [normalizedMissionId],
        );
        if (!missionCheck.rowCount) {
            throw new MissionNotFoundError(normalizedMissionId);
        }

        const geometry = createRandomGeometry();
        const properties = {
            color: ["#3b82f6", "#10b981", "#ef4444", "#f59e0b"][Math.floor(Math.random() * 4)],
            opacity: 0.8,
        };

        const result = await client.query<{ entity_id: string }>(
            `
                INSERT INTO entities(mission_id, entity_type, geom, properties)
                VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326), $4::jsonb)
                RETURNING entity_id
            `,
            [normalizedMissionId, geometry.entityType, geometry.wkt, JSON.stringify(properties)],
        );

        return {
            mission_id: normalizedMissionId,
            entity_id: result.rows[0].entity_id,
        };
    });
}
