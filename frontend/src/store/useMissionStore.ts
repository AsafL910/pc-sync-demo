import { create } from 'zustand';
import { MissionSummary } from '../types/nats';
import { useUIStore } from './useUIStore';
import { DB_SYNC_URL } from '../context/NATSContext';

interface MissionState {
    missions: MissionSummary[];
    selectedMissionId: string | null;
    createdMission: MissionSummary | null;
    setSelectedMissionId: (id: string | null) => void;
    setCreatedMission: (mission: MissionSummary | null) => void;
    setMissions: (missions: MissionSummary[]) => void;
    addMission: (mission: MissionSummary) => void;
    createMission: (name: string) => Promise<MissionSummary | null>;
}

export const useMissionStore = create<MissionState>((set) => ({
    missions: [],
    selectedMissionId: null,
    createdMission: null,
    setSelectedMissionId: (id) => set({ selectedMissionId: id }),
    setCreatedMission: (mission) => set({ createdMission: mission }),
    setMissions: (missions) => set(() => {
        // Filter "Default Operation" as a safety measure
        const filtered = missions.filter(m => m.name !== 'Default Operation' && m.name !== 'Default Operations');
        return { missions: filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) };
    }),
    addMission: (mission) => set((state) => {
        if (mission.name === 'Default Operation' || mission.name === 'Default Operations') return state;
        if (state.missions.some(m => m.id === mission.id)) return state;
        const updated = [mission, ...state.missions];
        return { missions: updated.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) };
    }),
    createMission: async (name) => {
        const { showToast } = useUIStore.getState();
        try {
            const res = await fetch(`${DB_SYNC_URL}/missions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (res.ok) {
                const data = await res.json() as MissionSummary;
                set({ createdMission: data, selectedMissionId: data.id });
                showToast(`✅ Mission "${data.name}" created`);
                return data;
            }
            return null;
        } catch (e: any) {
            showToast(`❌ Error: ${e.message}`);
            return null;
        }
    },
}));
