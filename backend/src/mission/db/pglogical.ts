import type { PoolClient } from "pg";
import { buildLocalDsn, buildPeerDsn, missionDbConfig } from "./config.js";
import { withClient } from "./pool.js";
const safeId = (id: string) => id.replace(/-/g, "_");

const replicationTables = ["missions", "infra", "entities", "active_mission"] as const;
const SUBSCRIPTION_RETRY_MS = 15000;

function isAlreadyExistsError(error: unknown): boolean {
    return error instanceof Error && (
        error.message.includes("already exists") ||
        error.message.includes("already") ||
        error.message.includes("duplicate")
    );
}

async function ensureNode(client: PoolClient): Promise<void> {
    const nodeExists = await client.query(
        "SELECT 1 FROM pglogical.node WHERE node_name = $1",
        [safeId(missionDbConfig.nodeName)],
    );

    if (nodeExists.rowCount) {
        return;
    }

    await client.query(
        "SELECT pglogical.create_node(node_name := $1, dsn := $2)",
        [safeId(missionDbConfig.nodeName), buildLocalDsn()],
    );
    console.log(`[${missionDbConfig.nodeName}] pglogical node created`);
}

async function ensureReplicationSet(client: PoolClient): Promise<void> {
    try {
        await client.query(`
          SELECT pglogical.create_replication_set(
            set_name := 'mesh_replication',
            replicate_insert := true,
            replicate_update := true,
            replicate_delete := true,
            replicate_truncate := true
          )
        `);
        console.log(`[${missionDbConfig.nodeName}] Replication set created`);
    } catch (error) {
        if (!isAlreadyExistsError(error)) {
            throw error;
        }

        console.log(`[${missionDbConfig.nodeName}] Replication set already exists`);
    }
}

async function ensureReplicationTables(client: PoolClient): Promise<void> {
    for (const table of replicationTables) {
        try {
            await client.query(
                `SELECT pglogical.replication_set_add_table(
                    set_name := 'mesh_replication',
                    relation := $1,
                    synchronize_data := true
                )`,
                [table],
            );
            console.log(`[${missionDbConfig.nodeName}] Table ${table} added to replication set`);
        } catch (error) {
            if (!isAlreadyExistsError(error)) {
                throw error;
            }

            console.log(`[${missionDbConfig.nodeName}] Table ${table} already in replication set`);
        }
    }
}

async function attemptSubscription(): Promise<boolean> {
    const subscriptionName = `sub_${safeId(missionDbConfig.nodeName)}_to_${safeId(missionDbConfig.peerNodeName)}`;

    return withClient(async (client) => {
        const nodeInfo = await client.query(
            "SELECT 1 FROM pglogical.node WHERE node_name = $1",
            [safeId(missionDbConfig.nodeName)],
        );
        if (!nodeInfo.rowCount) {
            console.log(`[${missionDbConfig.nodeName}] Local pglogical node not ready yet, skipping sub attempt`);
            return false;
        }

        const statusResult = await client.query(
            `SELECT subscription_name, status
             FROM pglogical.show_subscription_status()
             WHERE subscription_name = $1`,
            [subscriptionName],
        ).catch(() => ({ rows: [] as Array<{ subscription_name: string; status: string }> }));

        const currentStatus = statusResult.rows[0]?.status;
        if (currentStatus === "down") {
            console.log(`[${missionDbConfig.nodeName}] Subscription ${subscriptionName} is down, letting pglogical retry...`);
            return false;
        }

        const subExists = await client.query(
            "SELECT 1 FROM pglogical.subscription WHERE sub_name = $1",
            [subscriptionName],
        );

        if (!subExists.rowCount) {
            const peerDsn = buildPeerDsn();
            console.log(`[${missionDbConfig.nodeName}] Attempting to create subscription to: ${peerDsn}`);

            await client.query(
                `SELECT pglogical.create_subscription(
                    subscription_name := $1,
                    provider_dsn := $2,
                    replication_sets := ARRAY['mesh_replication'],
                    synchronize_data := true,
                    forward_origins := '{}',
                    apply_delay := '0 seconds'::interval
                )`,
                [subscriptionName, peerDsn],
            );
            console.log(`[${missionDbConfig.nodeName}] Subscription to ${missionDbConfig.peerNodeName} created successfully`);
        }

        const verifyStatus = await client.query(
            `SELECT status
             FROM pglogical.show_subscription_status()
             WHERE subscription_name = $1`,
            [subscriptionName],
        ).catch(() => ({ rows: [] as Array<{ status: string }> }));

        const status = verifyStatus.rows[0]?.status;
        if (!status || status === "down") {
            console.log(`[${missionDbConfig.nodeName}] Subscription ${subscriptionName} is not healthy yet (status: ${status || "unknown"})`);
            return false;
        }

        return true;
    });
}

function scheduleSubscriptionRetry(): void {
    const retryHandle = setTimeout(async () => {
        try {
            if (await attemptSubscription()) {
                console.log(`[${missionDbConfig.nodeName}] pglogical subscription established!`);
                return;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[${missionDbConfig.nodeName}] Subscription retry error:`, message);
        }

        scheduleSubscriptionRetry();
    }, SUBSCRIPTION_RETRY_MS);

    retryHandle.unref?.();
}

async function waitForHealthySubscription(): Promise<void> {
    const established = await attemptSubscription();
    if (established) {
        console.log(`[${missionDbConfig.nodeName}] pglogical subscription verified`);
        return;
    }

    console.log(`[${missionDbConfig.nodeName}] pglogical will retry subscription every ${SUBSCRIPTION_RETRY_MS / 1000}s...`);
    scheduleSubscriptionRetry();
}

export async function setupPglogical(): Promise<void> {
    await withClient(async (client) => {
        await ensureNode(client);
        await ensureReplicationSet(client);
        await ensureReplicationTables(client);
    });

    await waitForHealthySubscription();
    console.log(`[${missionDbConfig.nodeName}] pglogical setup process initiated`);
}
