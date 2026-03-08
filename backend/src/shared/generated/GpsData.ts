
interface GpsData {
  node: string;
  mission_id: string;
  lat: number;
  lng: number;
  timestamp: string;
  additionalProperties?: Map<string, any>;
}
export default GpsData;
