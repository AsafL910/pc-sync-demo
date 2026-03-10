import AlertSeverity from './AlertSeverity';
interface ReservedAlert {
  'node': string;
  'type': string;
  'severity': AlertSeverity;
  'message': string;
  'timestamp': string;
  'data'?: Map<string, any>;
  'additionalProperties'?: Map<string, any>;
}
export default ReservedAlert;
