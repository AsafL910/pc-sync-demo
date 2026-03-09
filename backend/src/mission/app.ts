import { Express } from 'express';
import { createBaseApp } from '../shared/express.js';
import {
    MissionNotFoundError,
    MissionValidationError,
    createMission,
    getActiveEntities,
    getMapRenderLayer,
    getMissions,
    insertRandomEntity,
} from './database.js';

function handleMissionError(nodeName: string, scope: string, error: unknown, res: any): void {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof MissionValidationError) {
        res.status(400).json({ error: message });
        return;
    }

    if (error instanceof MissionNotFoundError) {
        res.status(404).json({ error: message });
        return;
    }

    console.error(`[${nodeName}] ${scope}:`, message);
    res.status(500).json({ error: message });
}

export function setupMissionApp(): Express {
    const app = createBaseApp('mission-service');
    const nodeName = process.env.NODE_NAME || 'node_a';

    app.get('/missions', async (req, res) => {
        try {
            const rows = await getMissions();
            res.json(rows);
        } catch (error) {
            handleMissionError(nodeName, 'Query error', error, res);
        }
    });

    app.post('/missions', async (req, res) => {
        try {
            const { name } = req.body;
            if (typeof name !== 'string') {
                return res.status(400).json({ error: 'Name is required' });
            }

            const result = await createMission(name);
            res.status(201).json(result);
        } catch (error) {
            handleMissionError(nodeName, 'Create mission error', error, res);
        }
    });

    app.get('/entities/render', async (req, res) => {
        try {
            const missionId = typeof req.query.mission_id === 'string' ? req.query.mission_id : null;
            if (!missionId) return res.status(400).json({ error: 'mission_id is required' });
            const rows = await getMapRenderLayer(missionId);
            res.json(rows);
        } catch (error) {
            handleMissionError(nodeName, 'Query error', error, res);
        }
    });

    app.get('/entities', async (req, res) => {
        try {
            const missionId = typeof req.query.mission_id === 'string' ? req.query.mission_id : null;
            if (!missionId) return res.status(400).json({ error: 'mission_id is required' });
            const rows = await getActiveEntities(missionId);
            res.json(rows);
        } catch (error) {
            handleMissionError(nodeName, 'Query error', error, res);
        }
    });

    app.post('/entities', async (req, res) => {
        try {
            const { mission_id } = req.body;
            if (typeof mission_id !== 'string') {
                return res.status(400).json({ error: 'mission_id is required' });
            }

            const result = await insertRandomEntity(mission_id);
            res.status(201).json(result);
        } catch (error) {
            handleMissionError(nodeName, 'Insert error', error, res);
        }
    });

    return app;
}
