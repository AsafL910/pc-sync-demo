import { useMissionStore } from '../store/useMissionStore';
import { useUIActions } from './useUIActions';
import { DB_SYNC_URL } from '../context/NATSContext';
import { MissionSummary } from '../types/nats';

export const useMissionActions = () => {
    const { showToast } = useUIActions();
    const { setSelectedMissionId, setCreatedMission } = useMissionStore((state) => state.actions);

    const createMission = async (name: string): Promise<MissionSummary | null> => {
        try {
            const res = await fetch(`${DB_SYNC_URL}/missions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (res.ok) {
                const data = await res.json() as MissionSummary;
                setCreatedMission(data);
                setSelectedMissionId(data.id);
                showToast(`✅ Mission "${data.name}" created`);
                return data;
            }
            const error = await res.json().catch(() => null);
            showToast(`❌ Error: ${error?.error || 'Failed to create mission'}`);
            return null;
        } catch (e: any) {
            showToast(`❌ Error: ${e.message}`);
            return null;
        }
    };

    return { createMission };
};
