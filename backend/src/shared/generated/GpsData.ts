
interface GpsData {
  'node': string;
  'lat': number;
  'lng': number;
  'timestamp': string;
  'additionalProperties'?: Map<string, any>;
}
export default GpsData;
