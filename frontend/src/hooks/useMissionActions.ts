import { useMissionStore } from '../store/useMissionStore';
import { useUIActions } from './useUIActions';
import { DB_SYNC_URL } from '../context/NATSContext';
import { MissionSummary } from '../types/nats';

export const useMissionActions = () => {
    const { showToast } = useUIActions();
    const { setSelectedMissionId, setCreatedMission } = useMissionStore((state) => state.actions);

    const fetchActiveMission = async () => {
        try {
            const res = await fetch(`${DB_SYNC_URL}/missions/active`);
            if (res.ok) {
                const data = await res.json();
                if (data.mission_id) {
                    setSelectedMissionId(data.mission_id);
                }
            }
        } catch (e) {
            console.error('Failed to fetch active mission:', e);
        }
    };

    const setActiveMissionDb = async (missionId: string) => {
        try {
            const res = await fetch(`${DB_SYNC_URL}/missions/active`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mission_id: missionId })
            });
            if (res.ok) {
                setSelectedMissionId(missionId);
            }
        } catch (e) {
            console.error('Failed to set active mission:', e);
        }
    };

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
                await setActiveMissionDb(data.id);
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

    return { createMission, fetchActiveMission, setActiveMissionDb };
};
