import { useState, useEffect } from 'react';
import { connect } from 'nats.ws';

const NATS_URL = import.meta.env.VITE_NATS_URL || 'ws://localhost:8081';

export function useNATS() {
    const [nc, setNc] = useState(null);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        let natsConn;
        async function initNats() {
            try {
                natsConn = await connect({ servers: [NATS_URL], waitOnFirstConnect: true });
                setNc(natsConn);
                setConnected(true);
                console.log(`Connected to NATS: ${NATS_URL}`);
            } catch (err) {
                console.error("NATS connection error:", err);
                setTimeout(initNats, 3000);
            }
        }
        initNats();
        return () => {
            if (natsConn) natsConn.close();
        };
    }, []);

    return { nc, connected };
}
