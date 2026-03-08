import { useState, useEffect, useRef } from 'react';
import { StringCodec, AckPolicy, DeliverPolicy, ConsumerMessages, JsMsg } from 'nats.ws';
import { StatusDot } from './StatusDot';
import { AlertsPanelProps, SafetyAlert } from '../types/nats';

const NODE_NAME = import.meta.env.VITE_NODE_NAME || 'Node A';
const NODE_DOMAIN = NODE_NAME.toLowerCase().replace(' ', '_');
const PEER_DOMAIN = NODE_DOMAIN === 'node_a' ? 'node_b' : 'node_a';

const sc = StringCodec();

export const AlertsPanel = ({ nc }: AlertsPanelProps) => {
    const [alerts, setAlerts] = useState<SafetyAlert[]>([]);
    const [jsConnected, setJsConnected] = useState<boolean>(false);
    const setupAttemptRef = useRef(0);

    useEffect(() => {
        if (!nc) return;

        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const subs: ConsumerMessages[] = [];

        const clearResources = () => {
            subs.splice(0).forEach((sub) => sub.stop());
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
        };

        const scheduleRetry = () => {
            if (cancelled) return;
            const delay = Math.min(1000 * Math.pow(2, setupAttemptRef.current), 5000);
            retryTimer = setTimeout(() => {
                void setupJetStream();
            }, delay);
        };

        const setupJetStream = async () => {
            clearResources();
            setJsConnected(false);

            try {
                const jsm = await nc.jetstreamManager({ domain: NODE_DOMAIN });
                const js = nc.jetstream({ domain: NODE_DOMAIN });
                const streams = ['SAFETY_ALERTS', `MIRROR_SAFETY_${PEER_DOMAIN.toUpperCase()}`];
                let connectedStreams = 0;

                for (const streamName of streams) {
                    try {
                        const ci = await jsm.consumers.add(streamName, {
                            ack_policy: AckPolicy.Explicit,
                            deliver_policy: DeliverPolicy.All,
                        });

                        const consumer = await js.consumers.get(streamName, ci.name);
                        const iter = await consumer.consume();
                        console.log(`[JetStream] Pull Consumer created for stream: ${streamName} (Consumer: ${ci.name})`);

                        const processMessages = async () => {
                            for await (const m of iter) {
                                const msg = m as JsMsg;
                                try {
                                    const data = JSON.parse(sc.decode(msg.data)) as SafetyAlert;
                                    setAlerts((prev) => {
                                        if (prev.some((a) => a.timestamp === data.timestamp && a.node === data.node)) return prev;
                                        return [{ ...data, seq: msg.seq }, ...prev].slice(0, 50);
                                    });
                                    msg.ack();
                                } catch {
                                    msg.ack();
                                }
                            }
                        };
                        void processMessages();

                        subs.push(iter);
                        connectedStreams += 1;
                    } catch (err: any) {
                        console.warn(`[JetStream] Consumer creation failed for ${streamName}:`, err.message);
                    }
                }

                if (cancelled) {
                    clearResources();
                    return;
                }

                if (connectedStreams === streams.length) {
                    setupAttemptRef.current = 0;
                    setJsConnected(true);
                    return;
                }

                setupAttemptRef.current += 1;
                scheduleRetry();
            } catch (err) {
                if (cancelled) return;
                console.error('[JetStream] Manager setup error:', err);
                setupAttemptRef.current += 1;
                scheduleRetry();
            }
        };

        void setupJetStream();

        return () => {
            cancelled = true;
            setJsConnected(false);
            clearResources();
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
                                    ⚠️ {m.reservedType?.toUpperCase()} — {m.severity}
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
};
