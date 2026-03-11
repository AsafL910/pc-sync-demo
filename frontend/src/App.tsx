import { useState } from 'react';
import { StringCodec } from 'nats.ws';
import { useNATS } from './hooks/useNATS';
import { StatusDot } from './components/StatusDot';
import { DBPanel } from './components/DBPanel';
import { GPSPanel } from './components/GPSPanel';
import { AlertsPanel } from './components/AlertsPanel';
import { MissionSelector } from './components/MissionSelector';
import { SafetyAlert, MissionSummary } from './types/nats';
import AlertSeverity from './generated/AlertSeverity';

const NATS_URL = import.meta.env.VITE_NATS_URL || 'ws://localhost:8081';
const NODE_NAME = import.meta.env.VITE_NODE_NAME || 'Node A';
const NODE_DOMAIN = NODE_NAME.toLowerCase().replace(' ', '_');

const sc = StringCodec();

const App = () => {
    const [toast, setToast] = useState<string | null>(null);
    const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
    const [createdMission, setCreatedMission] = useState<MissionSummary | null>(null);
    const { nc, connected } = useNATS();

    const showToast = (msg: string, duration: number = 3000) => {
        setToast(msg);
        setTimeout(() => setToast(null), duration);
    };

    const publishAlert = async () => {
        if (!nc) return showToast('❌ NATS not connected');
        try {
            const js = nc.jetstream({ domain: NODE_DOMAIN });
            const payload: SafetyAlert = {
                node: NODE_DOMAIN,
                type: 'manual',
                severity: AlertSeverity.HIGH,
                message: `Manual alert from ${NODE_NAME}`,
                timestamp: new Date().toISOString(),
            };
            const subject = `alert.safety.${payload.node}.manual`;
            await js.publish(subject, sc.encode(JSON.stringify(payload)));
            showToast('🚨 Safety alert published directly to Mesh');
        } catch (e: any) {
            showToast(`❌ Error: ${e.message}`);
        }
    };

    return (
        <div className="app">
            <header className="header">
                <div className="header-left">
                    <div className="header-logo">⬡</div>
                    <span className="header-title">Mesh Dashboard</span>
                    <MissionSelector
                        nc={nc}
                        onMissionChange={setSelectedMissionId}
                        selectedId={selectedMissionId}
                        createdMission={createdMission}
                    />
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
                <GPSPanel nc={nc} />
                <AlertsPanel nc={nc} />
            </div>
            <div className="panels-bottom">
                <DBPanel nc={nc} selectedMissionId={selectedMissionId} />
            </div>

            <div className="actions-bar">
                <button className="btn btn-outline" onClick={async () => {
                    const name = prompt('Enter mission name:', `Mission ${new Date().toLocaleTimeString()}`);
                    if (!name) return;
                    const DB_SYNC_URL = import.meta.env.VITE_DB_SYNC_URL || 'http://localhost:3001';
                    try {
                        const res = await fetch(`${DB_SYNC_URL}/missions`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name })
                        });
                        if (res.ok) {
                            const data = await res.json() as MissionSummary;
                            setCreatedMission(data);
                            setSelectedMissionId(data.id);
                            showToast(`✅ Mission "${data.name}" created`);
                        }
                    } catch (e: any) {
                        showToast(`❌ Error: ${e.message}`);
                    }
                }}>
                    ✨ Create Mission
                </button>
                <button className="btn btn-outline" onClick={publishAlert}>
                    🚨 Send Alert
                </button>
                <button
                    className={`btn ${!selectedMissionId ? 'btn-disabled' : 'btn-primary'}`}
                    onClick={async () => {
                        if (!selectedMissionId) {
                            showToast('❌ Select a mission before creating an entity');
                            return;
                        }
                        const DB_SYNC_URL = import.meta.env.VITE_DB_SYNC_URL || 'http://localhost:3001';
                        try {
                            const res = await fetch(`${DB_SYNC_URL}/entities`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ mission_id: selectedMissionId })
                            });
                            if (res.ok) {
                                showToast('📍 Entity added to mission');
                                return;
                            }
                            const error = await res.json().catch(() => null);
                            showToast(`❌ Error: ${error?.error || 'Failed to create entity'}`);
                        } catch (e: any) {
                            showToast(`❌ Error: ${e.message}`);
                        }
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
