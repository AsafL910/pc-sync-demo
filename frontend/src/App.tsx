import { useMissionStore } from './store/useMissionStore';
import { useEntityStore } from './store/useEntityStore';
import { useUIStore } from './store/useUIStore';
import { useNATSContext } from './context/NATSContext';
import { StatusDot } from './components/StatusDot';
import { DBPanel } from './components/DBPanel';
import { GPSPanel } from './components/GPSPanel';
import { AlertsPanel } from './components/AlertsPanel';
import { MissionSelector } from './components/MissionSelector';

const NODE_NAME = import.meta.env.VITE_NODE_NAME || 'Node A';
const NATS_URL = import.meta.env.VITE_NATS_URL || 'ws://localhost:8081';

const App = () => {
    const { toast } = useUIStore();
    const { selectedMissionId, createMission } = useMissionStore();
    const { createEntity } = useEntityStore();
    const { connected, publishManualAlert } = useNATSContext();

    return (
        <div className="app">
            <header className="header">
                <div className="header-left">
                    <div className="header-logo">⬡</div>
                    <span className="header-title">Mesh Dashboard</span>
                    <MissionSelector />
                </div>
                <div className="header-right">
                    <span className="header-conn">
                        <StatusDot online={connected} />
                        {connected ? 'NATS-WS Connected' : 'NATS-WS Disconnected'}
                    </span>
                    <span className="header-node">
                        {NODE_NAME}
                    </span>
                </div>
            </header>

            {!selectedMissionId && (
                <div className="mission-warning-banner">
                    ⚠️ No mission selected. Please select or <strong>Create Mission</strong> to start adding data.
                </div>
            )}
            <div className="panels-top">
                <GPSPanel />
                <AlertsPanel />
            </div>
            <div className="panels-bottom">
                <DBPanel />
            </div>

            <div className="actions-bar">
                <button className="btn btn-outline" onClick={async () => {
                    const name = prompt('Enter mission name:', `Mission ${new Date().toLocaleTimeString()}`);
                    if (name) await createMission(name);
                }}>
                    ✨ Create Mission
                </button>
                <button className="btn btn-outline" onClick={() => void publishManualAlert({})}>
                    🚨 Send Alert
                </button>
                <button
                    className={`btn ${!selectedMissionId ? 'btn-disabled' : 'btn-primary'}`}
                    onClick={() => {
                        if (selectedMissionId) void createEntity(selectedMissionId);
                    }}
                    disabled={!selectedMissionId}
                >
                    📍 Add Spatial Entity
                </button>
                <span className="action-status">
                    NATS: {NATS_URL} | Mission: {selectedMissionId?.slice(0, 8)}
                </span>
            </div>

            {toast && <div className="toast">{toast}</div>}
        </div>
    );
};

export default App;
