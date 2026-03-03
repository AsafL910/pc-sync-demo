export interface Alert {
    node: string;
    type: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
    data: Record<string, any>;
    timestamp: string;
}

export interface GPSData {
    node: string;
    lat: number;
    lng: number;
    timestamp: string;
}

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
