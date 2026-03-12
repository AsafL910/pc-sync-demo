import { create } from 'zustand';
import { MissionSummary } from '../types/nats';

interface MissionState {
    missions: MissionSummary[];
    selectedMissionId: string | null;
    createdMission: MissionSummary | null;
    actions: {
        setSelectedMissionId: (id: string | null) => void;
        setCreatedMission: (mission: MissionSummary | null) => void;
        setMissions: (missions: MissionSummary[]) => void;
        addMission: (mission: MissionSummary) => void;
    };
}

export const useMissionStore = create<MissionState>((set) => ({
    missions: [],
    selectedMissionId: null,
    createdMission: null,
    actions: {
        setSelectedMissionId: (id) => set({ selectedMissionId: id }),
        setCreatedMission: (mission) => set({ createdMission: mission }),
        setMissions: (missions) => set(() => ({
            missions: [...missions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        })),
        addMission: (mission) => set((state) => {
            if (state.missions.some(m => m.id === mission.id)) return state;
            const updated = [mission, ...state.missions];
            return {
                missions: updated.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            };
        }),
    }
}));

export const useMissionStoreActions = () => useMissionStore(s => s.actions);
