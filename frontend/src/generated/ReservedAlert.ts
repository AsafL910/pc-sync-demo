import AlertSeverity from './AlertSeverity';
interface ReservedAlert {
  node: string;
  reservedType: string;
  severity: AlertSeverity;
  message: string;
  data?: Map<string, any>;
  timestamp: string;
  additionalProperties?: Map<string, any>;
}
export default ReservedAlert;
