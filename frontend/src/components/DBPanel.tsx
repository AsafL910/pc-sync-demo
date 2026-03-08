import { useState, useCallback, useEffect, useRef } from 'react';
import { EntityDelta } from '../generated/EntityDelta';
import { StringCodec, AckPolicy, DeliverPolicy, JsMsg, ConsumerMessages } from 'nats.ws';

const NODE_NAME = import.meta.env.VITE_NODE_NAME || 'Node A';
const NODE_DOMAIN = NODE_NAME.toLowerCase().replace(' ', '_');
const DB_SYNC_URL = import.meta.env.VITE_DB_SYNC_URL || 'http://localhost:3001';
const sc = StringCodec();

const getPeerNodeName = (nodeName: string) => {
    if (nodeName === 'Node A') return 'node_b';
    if (nodeName === 'Node B') return 'node_a';
    return nodeName.toLowerCase().replace(' ', '_') === 'node_a' ? 'node_b' : 'node_a';
};

export const DBPanel = ({ nc, selectedMissionId }: { nc: any, selectedMissionId: string | null }) => {
    const [entities, setEntities] = useState<any[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const selectedMissionIdRef = useRef<string | null>(selectedMissionId);

    useEffect(() => {
        selectedMissionIdRef.current = selectedMissionId;
    }, [selectedMissionId]);

    const fetchEntities = useCallback(async (retries = 3): Promise<void> => {
        if (!selectedMissionId) {
            setEntities([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setEntities([]);

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const res = await fetch(`${DB_SYNC_URL}/entities?mission_id=${encodeURIComponent(selectedMissionId)}`);
                if (res.ok) {
                    const missionEntities = await res.json() as any[];
                    if (selectedMissionIdRef.current === selectedMissionId) {
                        setEntities(missionEntities);
                        setLoading(false);
                    }
                    return;
                }
            } catch (e) {
                // service not ready yet
            }

            if (attempt < retries - 1) {
                await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
            }
        }

        if (selectedMissionIdRef.current === selectedMissionId) {
            setLoading(false);
        }
    }, [selectedMissionId]);

    useEffect(() => {
        void fetchEntities();
    }, [fetchEntities]);

    useEffect(() => {
        if (!nc || !selectedMissionId) return;
        const iters: ConsumerMessages[] = [];
        const peerNodeName = getPeerNodeName(NODE_NAME);
        const streamNames = ['ENTITIES', `MIRROR_ENTITIES_${peerNodeName.toUpperCase()}`];

        const applyDelta = async (payload: EntityDelta) => {
            const activeMissionId = selectedMissionIdRef.current;
            if (!activeMissionId || payload.mission_id !== activeMissionId) {
                return;
            }

            if (payload.type === 'reload') {
                await fetchEntities(1);
                return;
            }

            if (payload.type === 'update') {
                setEntities((prev) => {
                    if (selectedMissionIdRef.current !== payload.mission_id) {
                        return prev;
                    }

                    const idx = prev.findIndex((e) => e.entity_id === payload.entity_id);
                    if (idx >= 0) {
                        const updated = [...prev];
                        updated[idx] = { ...updated[idx], ...payload };
                        return updated;
                    }
                    return [payload, ...prev];
                });
            }
        };

        const setupJetStream = async () => {
            try {
                const jsm = await nc.jetstreamManager({ domain: NODE_DOMAIN });
                const js = nc.jetstream({ domain: NODE_DOMAIN });

                for (const streamName of streamNames) {
                    try {
                        const ci = await jsm.consumers.add(streamName, {
                            ack_policy: AckPolicy.Explicit,
                            deliver_policy: DeliverPolicy.New,
                        });

                        const consumer = await js.consumers.get(streamName, ci.name);
                        const iter = await consumer.consume();
                        iters.push(iter);
                        console.log(`[DBPanel JetStream] Consuming from ${streamName} for mission ${selectedMissionId}`);

                        (async () => {
                            for await (const m of iter) {
                                const msg = m as JsMsg;
                                try {
                                    const payload = JSON.parse(sc.decode(msg.data)) as EntityDelta;
                                    await applyDelta(payload);
                                    msg.ack();
                                } catch (e) {
                                    console.error(`Failed to parse delta from ${streamName}:`, e);
                                    msg.ack();
                                }
                            }
                        })();
                    } catch (err: any) {
                        console.warn(`[DBPanel JetStream] Consumer failed for ${streamName}:`, err.message);
                    }
                }
            } catch (err) {
                console.error('[DBPanel JetStream] Setup error:', err);
            }
        };

        void setupJetStream();

        return () => {
            iters.forEach(iter => iter.stop());
        };
    }, [nc, fetchEntities, selectedMissionId]);

    return (
        <div className="panel" style={{ gridColumn: 'span 2' }}>
            <div className="panel-header">
                <span className="panel-title">
                    <span className="panel-icon">Map</span> Spatial Entities (Live)
                </span>
                <span className="panel-badge badge-blue">{entities.length} rendered</span>
            </div>
            <div className="panel-body">
                {loading ? (
                    <div className="empty-state"><div className="spinner" /></div>
                ) : entities.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-state-icon">Empty</span>
                        No entities found in mission
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Entity ID</th>
                                <th>Type</th>
                                <th>Version</th>
                                <th>Schema</th>
                                <th>Origin Node</th>
                                <th>Geometry Outline</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entities.slice(0, 50).map((e) => (
                                <tr key={e.entity_id}>
                                    <td title={e.entity_id}>{e.entity_id?.slice(0, 8)}...</td>
                                    <td>
                                        <span className={`status-tag status-${e.entity_type || 'unknown'}`}>
                                            {e.entity_type}
                                        </span>
                                    </td>
                                    <td>v{e.version}</td>
                                    <td>{e.schema_version}</td>
                                    <td>{e.origin_node}</td>
                                    <td style={{ maxWidth: '200px' }}>
                                        <div style={{
                                            fontSize: '10px',
                                            opacity: 0.8,
                                            fontFamily: 'var(--font-mono)',
                                            background: 'rgba(255,255,255,0.05)',
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {e.geometry ? (
                                                <>
                                                    <span style={{ color: 'var(--accent-cyan)' }}>{e.geometry.type}</span>: {
                                                        e.geometry.type === 'Point'
                                                            ? `${e.geometry.coordinates[0].toFixed(4)}, ${e.geometry.coordinates[1].toFixed(4)}`
                                                            : 'Complex Geometry'
                                                    }
                                                </>
                                            ) : '-'}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};
