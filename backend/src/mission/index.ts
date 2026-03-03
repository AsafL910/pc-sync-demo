import { setupMissionApp } from './app.js';
import { createSchema, setupPglogical } from './database.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const NODE_NAME = process.env.NODE_NAME || 'node_a';

async function start() {
    try {
        await createSchema();
        console.log(`[${NODE_NAME}] Waiting 5s for peer database...`);
        await new Promise(r => setTimeout(r, 5000));
        await setupPglogical();
    } catch (err: any) {
        console.error(`[${NODE_NAME}] Setup error:`, err.message);
        console.log(`[${NODE_NAME}] Will retry pglogical setup in 10s...`);
        setTimeout(async () => {
            try { await setupPglogical(); } catch (e: any) {
                console.error(`[${NODE_NAME}] pglogical retry failed:`, e.message);
            }
        }, 10000);
    }

    const app = setupMissionApp();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Mission Service listening on port ${PORT}`);
    });
}

start();
