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

export interface MissionSummary {
    id: string;
    name: string;
    created_at: string;
}

export interface MissionCreatedMessage extends MissionSummary {
    node: string;
    timestamp: string;
    seq?: number;
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
