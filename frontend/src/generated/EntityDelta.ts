export interface EntityDelta {
    type: 'changed';
    mission_id: string;
    last_change_seq: number;
    origin_node?: string;
}
