import GpsData from './generated/GpsData.js';
import ReservedAlert from './generated/ReservedAlert.js';
import AlertSeverity from './generated/AlertSeverity.js';

export { GpsData, ReservedAlert, AlertSeverity };

export interface MissionRelation {
    id?: string;
    relation_id: string;
    point_id: string;
    polygon_id: string;
    status: 'connected' | 'disconnected';
    metadata: Record<string, any>;
    created_at?: string;
    origin_node: string;
}
