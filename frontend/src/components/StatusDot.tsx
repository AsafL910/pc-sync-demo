import { StatusDotProps } from '../types/nats';

export const StatusDot = ({ online }: StatusDotProps) => {
    return <span className={`status-dot ${online ? 'online' : 'offline'}`} />;
};
