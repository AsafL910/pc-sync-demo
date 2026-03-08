export interface EntityDelta {
    type: 'update' | 'reload';
    mission_id?: string;
    entity_id?: string;
    entity_type?: string;
    geometry?: any;
    properties?: any;
    version?: number;
    schema_version?: number;
    origin_node?: string;
}
