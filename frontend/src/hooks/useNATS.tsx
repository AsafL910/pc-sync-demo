import { useState, useEffect } from 'react';
import { connect, NatsConnection } from 'nats.ws';
import { UseNatsReturn } from '../types/nats';

const NATS_URL = import.meta.env.VITE_NATS_URL || 'ws://localhost:8081';

export const useNATS = (): UseNatsReturn => {
    const [nc, setNc] = useState<NatsConnection | null>(null);
    const [connected, setConnected] = useState<boolean>(false);

    useEffect(() => {
        let natsConn: NatsConnection;
        const initNats = async () => {
            try {
                natsConn = await connect({ servers: [NATS_URL], waitOnFirstConnect: true });
                setNc(natsConn);
                setConnected(true);
                console.log(`Connected to NATS: ${NATS_URL}`);
            } catch (err) {
                console.error("NATS connection error:", err);
                setTimeout(initNats, 3000);
            }
        };
        initNats();

        return () => {
            if (natsConn) natsConn.close();
        };
    }, []);

    return { nc, connected };
};
