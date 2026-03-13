import { Express, Response } from 'express';
import { createBaseApp } from '../shared/express.js';
import {
    EntityNotFoundError,
    MissionNotFoundError,
    MissionValidationError,
    bumpEntityVersion,
    createMission,
    getActiveEntities,
    getEntityDeltaSince,
    getMapRenderLayer,
    getMissions,
    insertRandomEntity,
    softDeleteEntity,
    getActiveMission,
    setActiveMission,
} from './database.js';

function handleMissionError(nodeName: string, scope: string, error: unknown, res: Response): void {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof MissionValidationError) {
        res.status(400).json({ error: message });
        return;
    }

    if (error instanceof MissionNotFoundError || error instanceof EntityNotFoundError) {
        res.status(404).json({ error: message });
        return;
    }

    console.error(`[${nodeName}] ${scope}:`, message);
    res.status(500).json({ error: message });
}

function parseSinceSeq(value: unknown): number {
    if (typeof value !== 'string') {
        throw new MissionValidationError('since_seq is required');
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new MissionValidationError('since_seq must be a non-negative integer');
    }

    return parsed;
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

    app.get('/missions/active', async (req, res) => {
        try {
            const result = await getActiveMission();
            res.json(result);
        } catch (error) {
            handleMissionError(nodeName, 'Get active mission error', error, res);
        }
    });

    app.put('/missions/active', async (req, res) => {
        try {
            const { mission_id } = req.body;
            await setActiveMission(mission_id || null);
            res.status(200).json({ mission_id: mission_id || null });
        } catch (error) {
            handleMissionError(nodeName, 'Set active mission error', error, res);
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

    app.get('/entities/delta', async (req, res) => {
        try {
            const missionId = typeof req.query.mission_id === 'string' ? req.query.mission_id : null;
            if (!missionId) {
                return res.status(400).json({ error: 'mission_id is required' });
            }

            const sinceSeq = parseSinceSeq(req.query.since_seq);
            const rows = await getEntityDeltaSince(missionId, sinceSeq);
            res.json(rows);
        } catch (error) {
            handleMissionError(nodeName, 'Delta query error', error, res);
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

    app.patch('/entities/:entityId/version', async (req, res) => {
        try {
            const result = await bumpEntityVersion(req.params.entityId);
            res.json(result);
        } catch (error) {
            handleMissionError(nodeName, 'Version update error', error, res);
        }
    });

    app.delete('/entities/:entityId', async (req, res) => {
        try {
            const result = await softDeleteEntity(req.params.entityId);
            res.json(result);
        } catch (error) {
            handleMissionError(nodeName, 'Soft delete error', error, res);
        }
    });

    return app;
}
