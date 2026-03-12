import { useState, useEffect } from 'react';
import { StatusDot } from './StatusDot';
import { GPSMessage } from '../types/nats';
import { useNATSContext } from '../context/NATSContext';
import { useNATSActions } from '../hooks/useNATSActions';

export const GPSPanel = () => {
    const [messages, setMessages] = useState<GPSMessage[]>([]);
    const { connected } = useNATSContext();
    const { subscribeGps } = useNATSActions();
    const maxMessages = 50;

    useEffect(() => {
        const unsubscribe = subscribeGps((data) => {
            setMessages((prev) => [data, ...prev].slice(0, maxMessages));
        });
        return unsubscribe;
    }, [subscribeGps]);

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-title">
                    <span className="panel-icon">📡</span> Live GPS Feed
                </span>
                <span className={`panel-badge ${connected ? 'badge-green' : 'badge-red'}`}>
                    <StatusDot online={connected} />
                    {connected ? 'LIVE' : 'OFFLINE'}
                </span>
            </div>
            <div className="panel-body">
                {messages.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-state-icon">🛰️</span>
                        Waiting for GPS data…
                    </div>
                ) : (
                    messages.map((m, i) => (
                        <div className="feed-item" key={i}>
                            <div className="feed-item-header">
                                <span className="feed-item-source">{m.node}</span>
                                <span className="feed-item-time">
                                    {m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ''}
                                </span>
                            </div>
                            <div className="feed-item-body">
                                lat: {m.lat} | lng: {m.lng}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
