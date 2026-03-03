import { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createBaseApp } from '../shared/express.js';
import { insertRelation, getActiveRelations, getAllRelations } from './database.js';

export function setupMissionApp(): Express {
    const app = createBaseApp('mission-service');
    const nodeName = process.env.NODE_NAME || 'node_a';

    app.post('/relations', async (req, res) => {
        try {
            const {
                relation_id = uuidv4(),
                point_id,
                polygon_id,
                status = 'connected',
                metadata = {}
            } = req.body;

            const row = await insertRelation({ relation_id, point_id, polygon_id, status, metadata });
            console.log(`[${nodeName}] Inserted relation: ${relation_id}`);
            res.status(201).json(row);
        } catch (err: any) {
            console.error(`[${nodeName}] Insert error:`, err.message);
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/relations', async (req, res) => {
        try {
            const rows = await getActiveRelations();
            res.json(rows);
        } catch (err: any) {
            console.error(`[${nodeName}] Query error:`, err.message);
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/relations/all', async (req, res) => {
        try {
            const rows = await getAllRelations();
            res.json(rows);
        } catch (err: any) {
            console.error(`[${nodeName}] Query error:`, err.message);
            res.status(500).json({ error: err.message });
        }
    });

    return app;
}
