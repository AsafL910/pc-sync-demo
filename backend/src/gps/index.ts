import { connectNats } from '../shared/nats.js';
import { setupGpsApp } from './app.js';
import { setupGpsPubSub } from './nats.js';

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const PORT = parseInt(process.env.PORT || '3100', 10);

async function start() {
    try {
        const nc = await connectNats('gps-service', NATS_URL);

        const app = setupGpsApp();
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`GPS Service listening on port ${PORT}`);
        });

        await setupGpsPubSub(nc);

        const shutdown = async () => {
            console.log('Shutting down GPS Service...');
            await nc.drain();
            server.close();
            process.exit(0);
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

    } catch (err) {
        console.error('Fatal error in GPS Service:', err);
        process.exit(1);
    }
}

start();
