import { Express } from 'express';
import { createBaseApp } from '../shared/express.js';
import { getMapRenderLayer, getActiveEntities, insertRandomEntity, getMissions, createMission } from './database.js';

export function setupMissionApp(): Express {
    const app = createBaseApp('mission-service');
    const nodeName = process.env.NODE_NAME || 'node_a';

    app.get('/missions', async (req, res) => {
        try {
            const rows = await getMissions();
            res.json(rows);
        } catch (err: any) {
            console.error(`[${nodeName}] Query error:`, err.message);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/missions', async (req, res) => {
        try {
            const { name } = req.body;
            if (!name) return res.status(400).json({ error: 'Name is required' });
            const result = await createMission(name);
            res.status(201).json(result);
        } catch (err: any) {
            console.error(`[${nodeName}] Create mission error:`, err.message);
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/entities/render', async (req, res) => {
        try {
            const missionId = typeof req.query.mission_id === 'string' ? req.query.mission_id : null;
            if (!missionId) return res.status(400).json({ error: 'mission_id is required' });
            const rows = await getMapRenderLayer(missionId);
            res.json(rows);
        } catch (err: any) {
            console.error(`[${nodeName}] Query error:`, err.message);
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/entities', async (req, res) => {
        try {
            const missionId = typeof req.query.mission_id === 'string' ? req.query.mission_id : null;
            if (!missionId) return res.status(400).json({ error: 'mission_id is required' });
            const rows = await getActiveEntities(missionId);
            res.json(rows);
        } catch (err: any) {
            console.error(`[${nodeName}] Query error:`, err.message);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/entities', async (req, res) => {
        try {
            const { mission_id } = req.body;
            if (!mission_id) return res.status(400).json({ error: 'mission_id is required' });
            const result = await insertRandomEntity(mission_id);
            res.status(201).json(result);
        } catch (err: any) {
            console.error(`[${nodeName}] Insert error:`, err.message);
            res.status(500).json({ error: err.message });
        }
    });

    return app;
}
