import { useState, useEffect } from 'react';
import { StringCodec, AckPolicy, DeliverPolicy } from 'nats.ws';
import { StatusDot } from './StatusDot';

const NODE_NAME = import.meta.env.VITE_NODE_NAME || 'Node A';
const NODE_DOMAIN = NODE_NAME.toLowerCase().replace(' ', '_');
const PEER_DOMAIN = NODE_DOMAIN === 'node_a' ? 'node_b' : 'node_a';

const sc = StringCodec();

// ---- Safety Alerts Panel ----
export function AlertsPanel({ nc }) {
    const [alerts, setAlerts] = useState([]);
    const [jsConnected, setJsConnected] = useState(false);

    useEffect(() => {
        if (!nc) return;
        const subs = [];

        async function setupJetStream() {
            try {
                const jsm = await nc.jetstreamManager({ domain: NODE_DOMAIN });
                const js = nc.jetstream({ domain: NODE_DOMAIN });
                const streams = ['SAFETY_ALERTS', `MIRROR_SAFETY_${PEER_DOMAIN.toUpperCase()}`];

                for (const streamName of streams) {
                    try {
                        const ci = await jsm.consumers.add(streamName, {
                            ack_policy: AckPolicy.Explicit,
                            deliver_policy: DeliverPolicy.All,
                        });

                        const consumer = await js.consumers.get(streamName, ci.name);
                        const iter = await consumer.consume();
                        console.log(`[JetStream] Pull Consumer created for stream: ${streamName} (Consumer: ${ci.name})`);

                        (async () => {
                            for await (const m of iter) {
                                try {
                                    const data = JSON.parse(sc.decode(m.data));
                                    setAlerts((prev) => {
                                        if (prev.some(a => a.timestamp === data.timestamp && a.node === data.node)) return prev;
                                        return [{ ...data, seq: m.seq }, ...prev].slice(0, 50);
                                    });
                                    m.ack();
                                } catch (err) { m.ack(); }
                            }
                        })();

                        subs.push(iter);
                    } catch (err) {
                        console.warn(`[JetStream] Consumer creation failed for ${streamName}:`, err.message);
                    }
                }
                setJsConnected(true);
            } catch (err) {
                console.error("[JetStream] Manager setup error:", err);
            }
        }

        setupJetStream();
        return () => {
            subs.forEach(s => {
                if (s.unsubscribe) s.unsubscribe();
                else if (s.close) s.close();
                else if (s.stop) s.stop();
            });
        };
    }, [nc]);

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-title">
                    <span className="panel-icon">🚨</span> Safety Alerts
                </span>
                <span className={`panel-badge ${jsConnected ? 'badge-green' : 'badge-amber'}`}>
                    <StatusDot online={jsConnected} />
                    Mesh {jsConnected ? 'VIRTUALIZED' : 'LOCKED'}
                </span>
            </div>
            <div className="panel-body">
                {alerts.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-state-icon">✅</span>
                        No alerts — all clear
                    </div>
                ) : (
                    alerts.map((m, i) => (
                        <div className="feed-item alert" key={i}>
                            <div className="feed-item-header">
                                <span className="feed-item-source">
                                    ⚠️ {m.type?.toUpperCase()} — {m.severity}
                                </span>
                                <span className="feed-item-time">
                                    seq: {m.seq} | {m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ''}
                                </span>
                            </div>
                            <div className="feed-item-body">
                                {m.message} (from {m.node})
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
