import { useState } from 'react';
import { StringCodec } from 'nats.ws';
import { useNATS } from './hooks/useNATS';
import { StatusDot } from './components/StatusDot';
import { DBPanel } from './components/DBPanel';
import { GPSPanel } from './components/GPSPanel';
import { AlertsPanel } from './components/AlertsPanel';
import { SafetyAlert } from './types/nats';

const DB_SYNC_URL = import.meta.env.VITE_DB_SYNC_URL || 'http://localhost:3001';
const NATS_URL = import.meta.env.VITE_NATS_URL || 'ws://localhost:8081';
const NODE_NAME = import.meta.env.VITE_NODE_NAME || 'Node A';
const NODE_DOMAIN = NODE_NAME.toLowerCase().replace(' ', '_');

const sc = StringCodec();

const App = () => {
    const [toast, setToast] = useState<string | null>(null);
    const { nc, connected } = useNATS();

    const showToast = (msg: string, duration: number = 3000) => {
        setToast(msg);
        setTimeout(() => setToast(null), duration);
    };

    const triggerConflict = async () => {
        const relationId = crypto.randomUUID();
        try {
            await fetch(`${DB_SYNC_URL}/relations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    relation_id: relationId,
                    point_id: `point-${NODE_NAME.replace(' ', '')}`,
                    polygon_id: `polygon-conflict-test`,
                    status: 'connected',
                    metadata: { conflict_test: true, source: NODE_NAME },
                }),
            });
            showToast(`⚡ Conflict triggered! relation_id=${relationId.slice(0, 8)}…`);
        } catch (e: any) {
            showToast(`❌ Error: ${e.message}`);
        }
    };

    const insertRelation = async () => {
        try {
            await fetch(`${DB_SYNC_URL}/relations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    point_id: `point-${Math.random().toString(36).slice(2, 6)}`,
                    polygon_id: `polygon-${Math.random().toString(36).slice(2, 6)}`,
                    status: 'connected',
                    metadata: { auto: true },
                }),
            });
            showToast('✅ Relation inserted');
        } catch (e: any) {
            showToast(`❌ Error: ${e.message}`);
        }
    };

    const publishAlert = async () => {
        if (!nc) return showToast('❌ NATS not connected');
        try {
            const js = nc.jetstream({ domain: NODE_DOMAIN });
            const payload: SafetyAlert = {
                node: NODE_DOMAIN,
                type: 'manual',
                severity: 'high',
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

            <div className="panels">
                <DBPanel />
                <GPSPanel nc={nc} />
                <AlertsPanel nc={nc} />
            </div>

            <div className="actions-bar">
                <button className="btn btn-primary" onClick={insertRelation}>
                    ➕ Insert Relation
                </button>
                <button className="btn btn-danger" onClick={triggerConflict}>
                    ⚡ Trigger Conflict
                </button>
                <button className="btn btn-outline" onClick={publishAlert}>
                    🚨 Send Alert
                </button>
                <span className="action-status">
                    DB: {DB_SYNC_URL} | NATS: {NATS_URL}
                </span>
            </div>

            {toast && <div className="toast">{toast}</div>}
        </div>
    );
};

export default App;
