import { NatsConnection } from 'nats.ws';
export type { NatsConnection, JetStreamClient } from 'nats.ws';

import GpsData from '../generated/GpsData';
import ReservedAlert from '../generated/ReservedAlert';
import AlertSeverity from '../generated/AlertSeverity';

export type { GpsData, ReservedAlert };
export { AlertSeverity };

export interface BaseMessage {
    node: string;
    timestamp: string;
}

export type GPSMessage = GpsData;
export interface SafetyAlert extends ReservedAlert {
    seq?: number;
}

export interface Relation {
    id: number;
    relation_id: string;
    point_id: string;
    polygon_id: string;
    status: string;
    origin_node: string;
    created_at: string;
}

export interface UseNatsReturn {
    nc: NatsConnection | null;
    connected: boolean;
}

export interface GPSPanelProps {
    nc: NatsConnection | null;
}

export interface AlertsPanelProps {
    nc: NatsConnection | null;
}

export interface StatusDotProps {
    online: boolean;
}
