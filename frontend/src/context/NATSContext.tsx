import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { connect, NatsConnection, StringCodec } from 'nats.ws';

const NATS_URL = import.meta.env.VITE_NATS_URL || 'ws://localhost:8081';
export const NODE_NAME = import.meta.env.VITE_NODE_NAME || 'Node A';
export const NODE_DOMAIN = NODE_NAME.toLowerCase().replace(' ', '-');
export const DB_SYNC_URL = import.meta.env.VITE_DB_SYNC_URL || 'http://localhost:3001';

export const sc = StringCodec();

interface NATSContextType {
    connected: boolean;
    nc: NatsConnection | null;
}

const NATSContext = createContext<NATSContextType | null>(null);

export const useNATSContext = () => {
    const context = useContext(NATSContext);
    if (!context) throw new Error('useNATSContext must be used within a NATSProvider');
    return context;
};

export const NATSProvider = ({ children }: { children: ReactNode }) => {
    const [nc, setNc] = useState<NatsConnection | null>(null);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        let natsConn: NatsConnection;
        const initNats = async () => {
            try {
                natsConn = await connect({ servers: [NATS_URL], waitOnFirstConnect: true });
                setNc(natsConn);
                setConnected(true);
                console.log(`[NATSContext] Connected to ${NATS_URL}`);
            } catch (err) {
                console.error("[NATSContext] Connection error:", err);
                setTimeout(initNats, 3000);
            }
        };
        initNats();

        return () => {
            if (natsConn) natsConn.close();
        };
    }, []);

    return (
        <NATSContext.Provider value={{ connected, nc }}>
            {children}
        </NATSContext.Provider>
    );
};
