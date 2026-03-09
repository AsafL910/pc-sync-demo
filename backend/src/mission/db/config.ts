export interface MissionDbConfig {
    nodeName: string;
    peerNodeName: string;
    dbHost: string;
    dbPort: number;
    peerDbHost: string;
    peerDbPort: number;
    dbUser: string;
    dbPass: string;
    dbName: string;
}

function parsePort(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export const missionDbConfig: MissionDbConfig = {
    nodeName: process.env.NODE_NAME || "node_a",
    peerNodeName: process.env.PEER_NODE_NAME || "node_b",
    dbHost: process.env.DB_HOST || "localhost",
    dbPort: parsePort(process.env.DB_PORT, 5432),
    peerDbHost: process.env.PEER_DB_HOST || "postgres_b",
    peerDbPort: parsePort(process.env.PEER_DB_PORT, 5432),
    dbUser: process.env.DB_USER || "mesh",
    dbPass: process.env.DB_PASS || "mesh_pass",
    dbName: process.env.DB_NAME || "meshdb",
};

export function buildLocalDsn(config: MissionDbConfig = missionDbConfig): string {
    return `host=${config.dbHost} port=${config.dbPort} dbname=${config.dbName} user=${config.dbUser} password=${config.dbPass}`;
}

export function buildPeerDsn(config: MissionDbConfig = missionDbConfig): string {
    return `host=${config.peerDbHost} port=${config.peerDbPort} dbname=${config.dbName} user=${config.dbUser} password=${config.dbPass}`;
}
