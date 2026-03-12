import { useCallback } from 'react';
import { AckPolicy, DeliverPolicy, JsMsg } from 'nats.ws';
import { useNATSContext, NODE_DOMAIN, NODE_NAME, sc } from '../context/NATSContext';
import { SafetyAlert, GPSMessage } from '../types/nats';
import EntityDelta from '../generated/EntityDelta';

export const useNATSActions = () => {
    const { nc } = useNATSContext();

    const subscribeToJetStream = useCallback((
        streamNames: string[],
        cb: (data: any, msg?: JsMsg) => void,
        onReady?: () => void
    ) => {
        if (!nc) return () => { };
        let cancelled = false;
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
                                    console.log(`[useNATSActions] Received message on ${streamName}:`, data);
                                    cb(data, msg);
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
                    console.log(`[useNATSActions] Setup retry ${retryCount}/${maxRetries} for ${streamNames.join(',')}...`);
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
        const PEER_DOMAIN = NODE_DOMAIN === 'node-a' ? 'node-b' : 'node-a';
        const streams = ['SAFETY_ALERTS', `MIRROR_SAFETY_${PEER_DOMAIN.toUpperCase()}`];

        return subscribeToJetStream(streams, (data, msg) => {
            cb({ ...data, seq: msg?.seq });
        }, onReady);
    }, [subscribeToJetStream]);

    const subscribeEntityDeltas = useCallback((cb: (data: EntityDelta) => void, onReady?: () => void) => {
        const PEER_DOMAIN = NODE_DOMAIN === 'node-a' ? 'node-b' : 'node-a';
        const streams = ['ENTITIES', `MIRROR_ENTITIES_${PEER_DOMAIN.toUpperCase()}`];

        return subscribeToJetStream(streams, cb, onReady);
    }, [subscribeToJetStream]);

    const subscribeMissions = useCallback((cb: (data: any) => void, onReady?: () => void) => {
        const PEER_DOMAIN = NODE_DOMAIN === 'node-a' ? 'node-b' : 'node-a';
        const streams = ['MISSIONS', `MIRROR_MISSIONS_${PEER_DOMAIN.toUpperCase()}`];

        return subscribeToJetStream(streams, cb, onReady);
    }, [subscribeToJetStream]);

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
            console.error("[useNATSActions] Failed to publish alert:", err);
            throw err;
        }
    }, [nc]);

    return {
        subscribeGps,
        subscribeAlerts,
        subscribeEntityDeltas,
        subscribeMissions,
        publishManualAlert
    };
};
