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

interface EntityRow {
    entity_id: string;
    mission_id: string;
    entity_type: string;
    geometry?: any;
    properties?: any;
    version?: number;
    mission_change_seq?: number;
    schema_version?: number;
    origin_node?: string;
}

interface EntityDeltaRow extends EntityRow {
    is_deleted: boolean;
}

function applyEntityDeltaRows(previous: EntityRow[], rows: EntityDeltaRow[]): EntityRow[] {
    const deletedIds = new Set(rows.filter((row) => row.is_deleted).map((row) => row.entity_id));
    const updatedRows = rows.filter((row) => !row.is_deleted);

    const remaining = previous.filter((entity) => !deletedIds.has(entity.entity_id));
    const untouched = remaining.filter((entity) => !updatedRows.some((row) => row.entity_id === entity.entity_id));

    return [...updatedRows, ...untouched];
}

export const DBPanel = ({ nc, selectedMissionId }: { nc: any, selectedMissionId: string | null }) => {
    const [entities, setEntities] = useState<EntityRow[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [busyEntityId, setBusyEntityId] = useState<string | null>(null);
    const selectedMissionIdRef = useRef<string | null>(selectedMissionId);
    const lastSeenSeqRef = useRef<number>(0);
    const syncInFlightRef = useRef<boolean>(false);
    const pendingTargetSeqRef = useRef<number>(0);

    useEffect(() => {
        selectedMissionIdRef.current = selectedMissionId;
    }, [selectedMissionId]);

    const fetchEntities = useCallback(async (retries = 3): Promise<void> => {
        if (!selectedMissionId) {
            setEntities([]);
            setLoading(false);
            lastSeenSeqRef.current = 0;
            pendingTargetSeqRef.current = 0;
            return;
        }

        setLoading(true);
        setEntities([]);

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const res = await fetch(`${DB_SYNC_URL}/entities?mission_id=${encodeURIComponent(selectedMissionId)}`);
                if (res.ok) {
                    const missionEntities = await res.json() as EntityRow[];
                    if (selectedMissionIdRef.current === selectedMissionId) {
                        setEntities(missionEntities);
                        const maxSeenSeq = missionEntities.reduce((max, entity) => Math.max(max, entity.mission_change_seq ?? 0), 0);
                        lastSeenSeqRef.current = maxSeenSeq;
                        pendingTargetSeqRef.current = maxSeenSeq;
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

    const applyDeltaRows = useCallback((rows: EntityDeltaRow[]) => {
        if (rows.length === 0) {
            return;
        }

        setEntities((previous) => applyEntityDeltaRows(previous, rows));
    }, []);

    const syncMissionDelta = useCallback(async (missionId: string, targetSeq: number) => {
        pendingTargetSeqRef.current = Math.max(pendingTargetSeqRef.current, targetSeq);
        if (syncInFlightRef.current) {
            return;
        }

        syncInFlightRef.current = true;
        try {
            while (pendingTargetSeqRef.current > lastSeenSeqRef.current) {
                const sinceSeq = lastSeenSeqRef.current;
                const desiredSeq = pendingTargetSeqRef.current;
                const res = await fetch(`${DB_SYNC_URL}/entities/delta?mission_id=${encodeURIComponent(missionId)}&since_seq=${sinceSeq}`);
                if (!res.ok) {
                    break;
                }

                const rows = await res.json() as EntityDeltaRow[];
                if (selectedMissionIdRef.current !== missionId) {
                    break;
                }

                applyDeltaRows(rows);
                const maxRowSeq = rows.reduce((max, row) => Math.max(max, row.mission_change_seq ?? 0), sinceSeq);
                lastSeenSeqRef.current = Math.max(lastSeenSeqRef.current, desiredSeq, maxRowSeq);
            }
        } finally {
            syncInFlightRef.current = false;
        }
    }, [applyDeltaRows]);

    const mutateEntity = useCallback(async (entityId: string, method: 'PATCH' | 'DELETE', path: string) => {
        setBusyEntityId(entityId);
        try {
            const res = await fetch(`${DB_SYNC_URL}${path}`, { method });
            if (!res.ok) {
                const error = await res.json().catch(() => null);
                throw new Error(error?.error || `Failed to ${method === 'PATCH' ? 'update' : 'delete'} entity`);
            }
        } finally {
            setBusyEntityId((current) => current === entityId ? null : current);
        }
    }, []);

    const bumpVersion = useCallback(async (entityId: string) => {
        await mutateEntity(entityId, 'PATCH', `/entities/${entityId}/version`);
    }, [mutateEntity]);

    const softDelete = useCallback(async (entityId: string) => {
        await mutateEntity(entityId, 'DELETE', `/entities/${entityId}`);
    }, [mutateEntity]);

    useEffect(() => {
        if (!nc || !selectedMissionId) return;
        const iters: ConsumerMessages[] = [];
        const peerNodeName = getPeerNodeName(NODE_NAME);
        const streamNames = ['ENTITIES', `MIRROR_ENTITIES_${peerNodeName.toUpperCase()}`];

        const applyPulse = async (payload: EntityDelta) => {
            const activeMissionId = selectedMissionIdRef.current;
            if (!activeMissionId || payload.type !== 'changed' || payload.mission_id !== activeMissionId) {
                return;
            }

            if (payload.last_change_seq <= lastSeenSeqRef.current) {
                return;
            }

            await syncMissionDelta(payload.mission_id, payload.last_change_seq);
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
                                    await applyPulse(payload);
                                    msg.ack();
                                } catch (e) {
                                    console.error(`Failed to parse delta pulse from ${streamName}:`, e);
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
    }, [nc, selectedMissionId, syncMissionDelta]);

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
                                <th>Seq</th>
                                <th>Schema</th>
                                <th>Origin Node</th>
                                <th>Geometry Outline</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entities.slice(0, 50).map((e) => {
                                const isBusy = busyEntityId === e.entity_id;

                                return (
                                    <tr key={e.entity_id}>
                                        <td title={e.entity_id}>{e.entity_id?.slice(0, 8)}...</td>
                                        <td>
                                            <span className={`status-tag status-${e.entity_type || 'unknown'}`}>
                                                {e.entity_type}
                                            </span>
                                        </td>
                                        <td>v{e.version}</td>
                                        <td>{e.mission_change_seq}</td>
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
                                        <td>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button className="btn btn-outline" disabled={isBusy} onClick={() => void bumpVersion(e.entity_id)}>
                                                    {isBusy ? '...' : 'Update'}
                                                </button>
                                                <button className="btn btn-outline" disabled={isBusy} onClick={() => void softDelete(e.entity_id)}>
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};
