import { connectNats } from '../shared/nats.js';
import { setupAlertsApp } from './app.js';
import { setupAlertsJetStream, consumeAlerts } from './nats.js';

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const PORT = parseInt(process.env.PORT || '3200', 10);

async function start() {
    try {
        const nc = await connectNats('alerts-service', NATS_URL);

        // Wait a bit for NATS to stabilize
        await new Promise(r => setTimeout(r, 3000));

        const app = setupAlertsApp(nc);
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`Alerts Service listening on port ${PORT}`);
        });

        const streamNames = await setupAlertsJetStream(nc);
        await consumeAlerts(nc, streamNames);

        const shutdown = async () => {
            console.log('Shutting down Alerts Service...');
            await nc.drain();
            server.close();
            process.exit(0);
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

    } catch (err) {
        console.error('Fatal error in Alerts Service:', err);
        process.exit(1);
    }
}

start();
