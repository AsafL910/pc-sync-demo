import { NatsConnection } from 'nats.ws';
export type { NatsConnection, JetStreamClient } from 'nats.ws';

export interface BaseMessage {
    node: string;
    timestamp: string;
}

export interface GPSMessage extends BaseMessage {
    lat: number;
    lng: number;
    speed: number;
    timestamp: string;
}

export interface SafetyAlert {
    node: string;
    type: string;
    severity: string;
    message: string;
    timestamp: string;
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
