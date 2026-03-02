export function StatusDot({ online }) {
    return <span className={`status-dot ${online ? 'online' : 'offline'}`} />;
}
