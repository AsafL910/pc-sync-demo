import { useEffect, useState, useRef } from 'react';
import { StringCodec, AckPolicy, DeliverPolicy, ConsumerMessages, JsMsg } from 'nats.ws';
import { MissionCreatedMessage, MissionSummary, NatsConnection } from '../types/nats';

interface MissionSelectorProps {
    selectedId: string | null;
    onMissionChange: (id: string) => void;
    nc: NatsConnection | null;
    createdMission: MissionSummary | null;
}

const NODE_NAME = import.meta.env.VITE_NODE_NAME || 'Node A';
const NODE_DOMAIN = NODE_NAME.toLowerCase().replace(' ', '_');
const DB_SYNC_URL = import.meta.env.VITE_DB_SYNC_URL || 'http://localhost:3001';
const sc = StringCodec();

export const MissionSelector = ({ selectedId, onMissionChange, nc, createdMission }: MissionSelectorProps) => {
    const [missions, setMissions] = useState<MissionSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const selectedIdRef = useRef(selectedId);
    const setupAttemptRef = useRef(0);

    useEffect(() => {
        selectedIdRef.current = selectedId;
    }, [selectedId]);

    const applyMissionList = (missionList: MissionSummary[]) => {
        const sorted = [...missionList].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setMissions(sorted);

        const currentSelectedId = selectedIdRef.current;
        const selectedStillExists = currentSelectedId ? sorted.some((mission) => mission.id === currentSelectedId) : false;
        if (sorted.length > 0 && (!currentSelectedId || !selectedStillExists)) {
            onMissionChange(sorted[0].id);
        }
    };

    const upsertMission = (mission: MissionSummary) => {
        setMissions((prev) => {
            const existing = prev.find((item) => item.id === mission.id);
            const next = existing
                ? prev.map((item) => (item.id === mission.id ? { ...item, ...mission } : item))
                : [mission, ...prev];

            return next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        });
    };

    const fetchMissions = async () => {
        try {
            const res = await fetch(`${DB_SYNC_URL}/missions`);
            const data = await res.json() as MissionSummary[];
            applyMissionList(data);
        } catch (e) {
            console.error('Failed to fetch missions:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void fetchMissions();
    }, []);

    useEffect(() => {
        if (!createdMission) return;
        upsertMission(createdMission);
    }, [createdMission]);

    useEffect(() => {
        if (!nc) return;

        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const subs: ConsumerMessages[] = [];

        const clearResources = () => {
            subs.splice(0).forEach((sub) => sub.stop());
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
        };

        const scheduleRetry = () => {
            if (cancelled) return;
            const delay = Math.min(1000 * Math.pow(2, setupAttemptRef.current), 5000);
            retryTimer = setTimeout(() => {
                void setupJetStream();
            }, delay);
        };

        const setupJetStream = async () => {
            clearResources();

            try {
                const jsm = await nc.jetstreamManager({ domain: NODE_DOMAIN });
                const js = nc.jetstream({ domain: NODE_DOMAIN });

                const ci = await jsm.consumers.add('MISSIONS', {
                    ack_policy: AckPolicy.Explicit,
                    deliver_policy: DeliverPolicy.All,
                });

                const consumer = await js.consumers.get('MISSIONS', ci.name);
                const iter = await consumer.consume();
                subs.push(iter);
                console.log('[MissionSelector JetStream] Consuming from MISSIONS');

                setupAttemptRef.current = 0;

                (async () => {
                    for await (const m of iter) {
                        const msg = m as JsMsg;
                        try {
                            const data = JSON.parse(sc.decode(msg.data)) as MissionCreatedMessage;
                            upsertMission({ id: data.id, name: data.name, created_at: data.created_at });
                            msg.ack();
                        } catch (err) {
                            console.error('[MissionSelector JetStream] Failed to parse MISSIONS message:', err);
                            msg.ack();
                        }
                    }

                    if (!cancelled) {
                        setupAttemptRef.current += 1;
                        scheduleRetry();
                    }
                })();
            } catch (err) {
                if (cancelled) return;
                console.error('[MissionSelector JetStream] Setup error:', err);
                setupAttemptRef.current += 1;
                scheduleRetry();
            }
        };

        void setupJetStream();

        return () => {
            cancelled = true;
            clearResources();
        };
    }, [nc]);

    if (loading && missions.length === 0) return <div className="mission-selector loading">Loading missions...</div>;

    return (
        <div className="mission-selector">
            <label htmlFor="mission-select">Mission:</label>
            <select
                id="mission-select"
                value={selectedId || ''}
                onChange={(e) => onMissionChange(e.target.value)}
                className="select"
            >
                {missions.map((mission) => (
                    <option key={mission.id} value={mission.id}>{mission.name}</option>
                ))}
            </select>
            <button className="btn-refresh" onClick={() => void fetchMissions()} title="Refresh missions">Refresh</button>
        </div>
    );
};
