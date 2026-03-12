import { useState, useCallback, useEffect, useRef } from 'react';
import { useMissionStore } from '../store/useMissionStore';
import { useEntityStore } from '../store/useEntityStore';
import { useNATSContext, DB_SYNC_URL } from '../context/NATSContext';

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

export const DBPanel = () => {
    const { selectedMissionId } = useMissionStore();
    const { updateEntityVersion, deleteEntity } = useEntityStore();
    const { subscribeEntityDeltas } = useNATSContext();

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

    const syncMissionDelta = useCallback(async (missionId: string, targetSeq: number) => {
        if (missionId !== selectedMissionIdRef.current) return;

        pendingTargetSeqRef.current = Math.max(pendingTargetSeqRef.current, targetSeq);

        // Only gate on sync in flight. The 'loading' gate is handled by the callers
        // to avoid circular dependency loops.
        if (syncInFlightRef.current) return;

        syncInFlightRef.current = true;
        let retries = 0;
        const MAX_REPLICATION_RETRIES = 10;
        try {
            while (pendingTargetSeqRef.current > lastSeenSeqRef.current && missionId === selectedMissionIdRef.current) {
                const sinceSeq = lastSeenSeqRef.current;
                const res = await fetch(`${DB_SYNC_URL}/entities/delta?mission_id=${encodeURIComponent(missionId)}&since_seq=${sinceSeq}`);
                if (!res.ok) break;

                const rows = await res.json() as EntityDeltaRow[];
                if (selectedMissionIdRef.current !== missionId) break;

                if (rows.length > 0) {
                    setEntities((previous) => applyEntityDeltaRows(previous, rows));
                }

                const maxRowSeq = rows.reduce((max, row) => Math.max(max, row.mission_change_seq ?? 0), sinceSeq);

                if (maxRowSeq <= sinceSeq) {
                    retries++;
                    if (retries >= MAX_REPLICATION_RETRIES) break;
                    await new Promise(r => setTimeout(r, 150));
                    continue;
                }

                retries = 0;
                lastSeenSeqRef.current = maxRowSeq;
            }
        } finally {
            syncInFlightRef.current = false;
        }
    }, [selectedMissionId]);

    useEffect(() => {
        let isCancelled = false;

        const fetchMissions = async () => {
            if (!selectedMissionId) {
                setEntities([]);
                setLoading(false);
                lastSeenSeqRef.current = 0;
                pendingTargetSeqRef.current = 0;
                return;
            }

            setLoading(true);
            // Reset sequence markers for the new mission context
            lastSeenSeqRef.current = 0;
            // Note: we don't reset pendingTargetSeqRef here because NATS updates 
            // might have already arrived while we were starting up.

            const MAX_RETRIES = 15;
            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                if (isCancelled) return;
                try {
                    const res = await fetch(`${DB_SYNC_URL}/entities?mission_id=${encodeURIComponent(selectedMissionId)}`);
                    if (res.ok) {
                        const missionEntities = await res.json() as EntityRow[];
                        if (isCancelled) return;

                        const maxSeenSeq = missionEntities.reduce((max, entity) => Math.max(max, entity.mission_change_seq ?? 0), 0);

                        // Safety: Only apply baseline if we haven't already synced past it via a very fast NATS pulse
                        if (maxSeenSeq >= lastSeenSeqRef.current) {
                            setEntities(missionEntities);
                            lastSeenSeqRef.current = maxSeenSeq;
                        }

                        setLoading(false);
                        // Trigger catch-up sync for anything that was queued in pendingTargetSeqRef while we were loading
                        void syncMissionDelta(selectedMissionId, pendingTargetSeqRef.current);
                        return;
                    }
                } catch (e) { /* ignore */ }

                const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
                await new Promise(r => setTimeout(r, delay));
            }

            if (!isCancelled) setLoading(false);
        };

        void fetchMissions();
        return () => { isCancelled = true; };
    }, [selectedMissionId]);

    const handleBumpVersion = async (entityId: string) => {
        setBusyEntityId(entityId);
        await updateEntityVersion(entityId);
        setBusyEntityId(null);
    };

    const handleDelete = async (entityId: string) => {
        setBusyEntityId(entityId);
        await deleteEntity(entityId);
        setBusyEntityId(null);
    };

    useEffect(() => {
        if (!selectedMissionId) return;

        const unsubscribe = subscribeEntityDeltas(async (payload) => {
            if (payload.type === 'changed' && payload.mission_id === selectedMissionId) {
                const targetSeq = payload.last_change_seq;
                pendingTargetSeqRef.current = Math.max(pendingTargetSeqRef.current, targetSeq);

                // Use 'loading' state to gate live updates to prevent overwriting the initial baseline
                if (!loading && targetSeq > lastSeenSeqRef.current) {
                    await syncMissionDelta(payload.mission_id, targetSeq);
                }
            }
        });

        return unsubscribe;
    }, [selectedMissionId, subscribeEntityDeltas, syncMissionDelta, loading]);

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
                                                <button className="btn btn-outline" disabled={isBusy} onClick={() => void handleBumpVersion(e.entity_id)}>
                                                    {isBusy ? '...' : 'Update'}
                                                </button>
                                                <button className="btn btn-outline" disabled={isBusy} onClick={() => void handleDelete(e.entity_id)}>
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
