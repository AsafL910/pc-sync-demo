import { useState, useEffect } from 'react';
import { StatusDot } from './StatusDot';
import { SafetyAlert } from '../types/nats';
import { useNATSActions } from '../hooks/useNATSActions';

export const AlertsPanel = () => {
    const [alerts, setAlerts] = useState<SafetyAlert[]>([]);
    const { subscribeAlerts } = useNATSActions();
    const [isSubscribed, setIsSubscribed] = useState(false);

    useEffect(() => {
        const unsubscribe = subscribeAlerts((data) => {
            setAlerts((prev) => {
                const exists = prev.some((a) => a.timestamp === data.timestamp && a.node === data.node && a.message === data.message);
                if (exists) return prev;
                return [data, ...prev].slice(0, 50);
            });
        }, () => {
            console.log("[AlertsPanel] Subscribed successfully");
            setIsSubscribed(true);
        });
        return () => {
            unsubscribe();
            setIsSubscribed(false);
        };
    }, [subscribeAlerts]);

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-title">
                    <span className="panel-icon">🚨</span> Safety Alerts
                </span>
                <span className={`panel-badge ${isSubscribed ? 'badge-green' : 'badge-amber'}`}>
                    <StatusDot online={isSubscribed} />
                    Mesh {isSubscribed ? 'VIRTUALIZED' : 'LOCKED'}
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
};
