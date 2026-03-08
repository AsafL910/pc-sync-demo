import { Express } from 'express';
import { NatsConnection } from 'nats';
import { createBaseApp } from '../shared/express.js';
import { publishAlert } from './nats.js';

export function setupAlertsApp(nc: NatsConnection): Express {
    const app = createBaseApp('alerts-service');
    const nodeName = process.env.NODE_NAME || 'node_a';

    app.post('/alerts', async (req, res) => {
        try {
            const { mission_id, type: reservedType = 'collision', severity = 'high', message = 'Safety alert', data = {} } = req.body;
            const payload = await publishAlert(nc, { mission_id, reservedType, severity, message, data });
            console.log(`[${nodeName}] Published safety alert: ${nodeName}.${reservedType}`);
            res.status(201).json(payload);
        } catch (err: any) {
            console.error(`[${nodeName}] Alert publish error:`, err.message);
            res.status(500).json({ error: err.message });
        }
    });

    return app;
}
