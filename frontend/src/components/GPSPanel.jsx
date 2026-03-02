import { useState, useEffect } from 'react';
import { StringCodec } from 'nats.ws';
import { StatusDot } from './StatusDot';

const sc = StringCodec();

export function GPSPanel({ nc }) {
    const [messages, setMessages] = useState([]);
    const maxMessages = 50;

    useEffect(() => {
        if (!nc) return;
        const sub = nc.subscribe('sensor.gps');
        (async () => {
            for await (const m of sub) {
                try {
                    const data = JSON.parse(sc.decode(m.data));
                    setMessages((prev) => [{ ...data, node: data.node || 'unknown' }, ...prev].slice(0, maxMessages));
                } catch (err) { /* ignore */ }
            }
        })();
        return () => sub.unsubscribe();
    }, [nc]);

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-title">
                    <span className="panel-icon">📡</span> Live GPS Feed
                </span>
                <span className={`panel-badge ${nc ? 'badge-green' : 'badge-red'}`}>
                    <StatusDot online={!!nc} />
                    {nc ? 'LIVE' : 'OFFLINE'}
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
                                lat: {m.lat}  lng: {m.lng}  speed: {m.speed} km/h
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
