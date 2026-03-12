import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { connect, NatsConnection, StringCodec, AckPolicy, DeliverPolicy, JsMsg } from 'nats.ws';
import { SafetyAlert, GPSMessage } from '../types/nats';
import EntityDelta from '../generated/EntityDelta';

const NATS_URL = import.meta.env.VITE_NATS_URL || 'ws://localhost:8081';
const NODE_NAME = import.meta.env.VITE_NODE_NAME || 'Node A';
const NODE_DOMAIN = NODE_NAME.toLowerCase().replace(' ', '_');
export const DB_SYNC_URL = import.meta.env.VITE_DB_SYNC_URL || 'http://localhost:3001';

const sc = StringCodec();

interface NATSContextType {
    connected: boolean;
    subscribeGps: (cb: (data: GPSMessage) => void) => () => void;
    subscribeAlerts: (cb: (data: SafetyAlert) => void, onReady?: () => void) => () => void;
    subscribeEntityDeltas: (cb: (data: EntityDelta) => void, onReady?: () => void) => () => void;
    subscribeMissions: (cb: (data: any) => void, onReady?: () => void) => () => void;
    publishManualAlert: (alert: Partial<SafetyAlert>) => Promise<void>;
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

    const subscribeGps = useCallback((cb: (data: GPSMessage) => void) => {
        if (!nc) return () => { };
        const sub = nc.subscribe('sensor.gps');
        const process = async () => {
            for await (const m of sub) {
                try {
                    const data = JSON.parse(sc.decode(m.data)) as GPSMessage;
                    cb({ ...data, node: data.node || 'unknown' });
                } catch (e) { /* ignore */ }
            }
        };
        process();
        return () => sub.unsubscribe();
    }, [nc]);

    const subscribeAlerts = useCallback((cb: (data: SafetyAlert) => void, onReady?: () => void) => {
        if (!nc) return () => { };
        let cancelled = false;

        const PEER_DOMAIN = NODE_DOMAIN === 'node_a' ? 'node_b' : 'node_a';
        const streams = ['SAFETY_ALERTS', `MIRROR_SAFETY_${PEER_DOMAIN.toUpperCase()}`];
        const subs: any[] = [];

        const setup = async () => {
            let retryCount = 0;
            const maxRetries = 10;
            while (retryCount < maxRetries && !cancelled) {
                try {
                    const jsm = await nc.jetstreamManager({ domain: NODE_DOMAIN });
                    const js = nc.jetstream({ domain: NODE_DOMAIN });

                    for (const streamName of streams) {
                        const ci = await jsm.consumers.add(streamName, {
                            ack_policy: AckPolicy.Explicit,
                            deliver_policy: DeliverPolicy.All,
                        });
                        const consumer = await js.consumers.get(streamName, ci.name);
                        const iter = await consumer.consume();
                        subs.push(iter);

                        (async () => {
                            for await (const m of iter) {
                                if (cancelled) break;
                                const msg = m as JsMsg;
                                try {
                                    const data = JSON.parse(sc.decode(msg.data)) as SafetyAlert;
                                    cb({ ...data, seq: msg.seq });
                                    msg.ack();
                                } catch {
                                    msg.ack();
                                }
                            }
                        })();
                    }
                    if (onReady) onReady();
                    break;
                } catch (e) {
                    retryCount++;
                    console.log(`[NATSContext] Alerts setup retry ${retryCount}/${maxRetries}...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        };
        setup();

        return () => {
            cancelled = true;
            subs.forEach(s => s.stop());
        };
    }, [nc]);

    const subscribeEntityDeltas = useCallback((cb: (data: EntityDelta) => void, onReady?: () => void) => {
        if (!nc) return () => { };
        let cancelled = false;
        const PEER_DOMAIN = NODE_DOMAIN === 'node_a' ? 'node_b' : 'node_a';
        const streamNames = ['ENTITIES', `MIRROR_ENTITIES_${PEER_DOMAIN.toUpperCase()}`];
        const iters: any[] = [];

        const setup = async () => {
            let retryCount = 0;
            const maxRetries = 10;

            while (retryCount < maxRetries && !cancelled) {
                try {
                    const jsm = await nc.jetstreamManager({ domain: NODE_DOMAIN });
                    const js = nc.jetstream({ domain: NODE_DOMAIN });

                    for (const streamName of streamNames) {
                        const ci = await jsm.consumers.add(streamName, {
                            ack_policy: AckPolicy.Explicit,
                            deliver_policy: DeliverPolicy.All,
                        });
                        const consumer = await js.consumers.get(streamName, ci.name);
                        const iter = await consumer.consume();
                        iters.push(iter);

                        (async () => {
                            for await (const m of iter) {
                                if (cancelled) break;
                                const msg = m as JsMsg;
                                try {
                                    const payload = JSON.parse(sc.decode(msg.data)) as EntityDelta;
                                    cb(payload);
                                    msg.ack();
                                } catch (e) {
                                    msg.ack();
                                }
                            }
                        })();
                    }
                    if (onReady) onReady();
                    break;
                } catch (e) {
                    retryCount++;
                    console.log(`[NATSContext] Entity setup retry ${retryCount}/${maxRetries}...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        };
        setup();

        return () => {
            cancelled = true;
            iters.forEach(i => i.stop());
        };
    }, [nc]);

    const publishManualAlert = useCallback(async (alert: Partial<SafetyAlert>) => {
        if (!nc) throw new Error('NATS not connected');
        try {
            const js = nc.jetstream({ domain: NODE_DOMAIN });
            const payload: SafetyAlert = {
                node: NODE_DOMAIN,
                type: 'manual',
                severity: 'HIGH' as any,
                message: `Manual alert from ${NODE_NAME}`,
                timestamp: new Date().toISOString(),
                ...alert
            };
            const subject = `alert.safety.${payload.node}.manual`;
            await js.publish(subject, sc.encode(JSON.stringify(payload)));
        } catch (err) {
            console.error("[NATSContext] Failed to publish alert:", err);
            throw err;
        }
    }, [nc]);

    const subscribeMissions = useCallback((cb: (data: any) => void, onReady?: () => void) => {
        if (!nc) return () => { };
        let cancelled = false;
        const PEER_DOMAIN = NODE_DOMAIN === 'node_a' ? 'node_b' : 'node_a';
        const streamNames = ['MISSIONS', `MIRROR_MISSIONS_${PEER_DOMAIN.toUpperCase()}`];
        const iters: any[] = [];

        const setup = async () => {
            let retryCount = 0;
            const maxRetries = 10;

            while (retryCount < maxRetries && !cancelled) {
                try {
                    const jsm = await nc.jetstreamManager({ domain: NODE_DOMAIN });
                    const js = nc.jetstream({ domain: NODE_DOMAIN });

                    for (const streamName of streamNames) {
                        const ci = await jsm.consumers.add(streamName, {
                            ack_policy: AckPolicy.Explicit,
                            deliver_policy: DeliverPolicy.All,
                        });
                        const consumer = await js.consumers.get(streamName, ci.name);
                        const iter = await consumer.consume();
                        iters.push(iter);

                        (async () => {
                            for await (const m of iter) {
                                if (cancelled) break;
                                const msg = m as JsMsg;
                                try {
                                    const data = JSON.parse(sc.decode(msg.data));
                                    cb(data);
                                    msg.ack();
                                } catch {
                                    msg.ack();
                                }
                            }
                        })();
                    }
                    if (onReady) onReady();
                    break;
                } catch (e) {
                    retryCount++;
                    console.log(`[NATSContext] Mission setup retry ${retryCount}/${maxRetries}...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        };
        setup();

        return () => {
            cancelled = true;
            iters.forEach(i => i.stop());
        };
    }, [nc]);

    return (
        <NATSContext.Provider value={{ connected, subscribeGps, subscribeAlerts, subscribeEntityDeltas, subscribeMissions, publishManualAlert }}>
            {children}
        </NATSContext.Provider>
    );
};
