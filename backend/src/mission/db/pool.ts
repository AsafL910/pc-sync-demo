import pg, { PoolClient } from "pg";
import { missionDbConfig } from "./config.js";

const { Pool } = pg;

export const missionPool = new Pool({
    host: missionDbConfig.dbHost,
    port: missionDbConfig.dbPort,
    user: missionDbConfig.dbUser,
    password: missionDbConfig.dbPass,
    database: missionDbConfig.dbName,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    application_name: `${missionDbConfig.nodeName}-mission-service`,
});

missionPool.on("error", (error) => {
    console.error(`[${missionDbConfig.nodeName}] Unexpected idle Postgres client error:`, error);
});

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await missionPool.connect();
    try {
        return await fn(client);
    } finally {
        client.release();
    }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return withClient(async (client) => {
        await client.query("BEGIN");
        try {
            const result = await fn(client);
            await client.query("COMMIT");
            return result;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
    });
}
