import DeltaType from './DeltaType';
interface EntityDelta {
  'type': DeltaType;
  'mission_id': string;
  'entity_id': string;
  'version': number;
  'last_change_seq': number;
  'origin_node': string;
  'additionalProperties'?: Map<string, any>;
}
export default EntityDelta;
