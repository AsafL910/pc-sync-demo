import { useState, useCallback, useEffect } from 'react';

const DB_SYNC_URL = import.meta.env.VITE_DB_SYNC_URL || 'http://localhost:3001';

export function DBPanel() {
    const [relations, setRelations] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchRelations = useCallback(async () => {
        try {
            const res = await fetch(`${DB_SYNC_URL}/relations`);
            if (res.ok) {
                setRelations(await res.json());
            }
        } catch (e) { /* server not ready */ }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchRelations();
        const interval = setInterval(fetchRelations, 1000);
        return () => clearInterval(interval);
    }, [fetchRelations]);

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-title">
                    <span className="panel-icon">🗄️</span> Local DB State
                </span>
                <span className="panel-badge badge-blue">{relations.length} rows</span>
            </div>
            <div className="panel-body">
                {loading ? (
                    <div className="empty-state"><div className="spinner" /></div>
                ) : relations.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-state-icon">📭</span>
                        No relations yet
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Relation ID</th>
                                <th>Point</th>
                                <th>Polygon</th>
                                <th>Status</th>
                                <th>Origin</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {relations.map((r) => (
                                <tr key={r.id}>
                                    <td title={r.relation_id}>{r.relation_id?.slice(0, 8)}…</td>
                                    <td>{r.point_id}</td>
                                    <td>{r.polygon_id}</td>
                                    <td>
                                        <span className={`status-tag status-${r.status}`}>
                                            {r.status}
                                        </span>
                                    </td>
                                    <td>{r.origin_node}</td>
                                    <td>{r.created_at ? new Date(r.created_at).toLocaleTimeString() : '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
