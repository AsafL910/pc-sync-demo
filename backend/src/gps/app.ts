import { Express } from 'express';
import { createBaseApp } from '../shared/express.js';

export function setupGpsApp(): Express {
    const app = createBaseApp('gps-service');
    return app;
}
