import express, { Express } from 'express';
import cors from 'cors';

export function createBaseApp(serviceName: string): Express {
    const app = express();
    const nodeName = process.env.NODE_NAME || 'unknown';

    app.use(cors());
    app.use(express.json());

    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            node: nodeName,
            service: serviceName,
            timestamp: new Date().toISOString()
        });
    });

    return app;
}
