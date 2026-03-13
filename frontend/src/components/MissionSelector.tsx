import { useEffect, useCallback } from 'react';
import { MissionSummary } from '../types/nats';
import { useMissionStore } from '../store/useMissionStore';
import { DB_SYNC_URL } from '../context/NATSContext';
import { useNATSActions } from '../hooks/useNATSActions';
import { useMissionActions } from '../hooks/useMissionActions';

export const MissionSelector = () => {
    const missions = useMissionStore(s => s.missions);
    const selectedMissionId = useMissionStore(s => s.selectedMissionId);
    const { setSelectedMissionId, setMissions, addMission } = useMissionStore(s => s.actions);
    const { subscribeMissions } = useNATSActions();
    const { fetchActiveMission, setActiveMissionDb } = useMissionActions();

    useEffect(() => {
        void fetchActiveMission();
    }, [fetchActiveMission]);

    const fetchMissions = useCallback(async () => {
        try {
            console.log("[MissionSelector] Fetching baseline missions...");
            const res = await fetch(`${DB_SYNC_URL}/missions`);
            const data = await res.json() as MissionSummary[];
            setMissions(data);
        } catch (e) {
            console.error('Failed to fetch missions:', e);
        }
    }, [setMissions]);

    useEffect(() => {
        void fetchMissions();
    }, [fetchMissions]);

    useEffect(() => {
        const unsubscribe = subscribeMissions((data) => {
            if (data.type === 'active_mission_changed' || data.mission_id !== undefined) {
                if (data.mission_id) {
                    setSelectedMissionId(data.mission_id);
                }
                return;
            }
            const missionData: MissionSummary = { id: data.id, name: data.name, created_at: data.created_at };
            addMission(missionData);
        }, () => {
            console.log("[MissionSelector] Subscribed to missions");
        });
        return unsubscribe;
    }, [subscribeMissions, addMission]);


    return (
        <div className="mission-selector">
            <label htmlFor="mission-select">Mission:</label>
            <select
                id="mission-select"
                value={selectedMissionId || ''}
                onChange={(e) => setActiveMissionDb(e.target.value)}
                className="select"
            >
                {missions.length === 0 ? (
                    <option value="" disabled>No missions available</option>
                ) : (
                    <>
                        <option value="" disabled>Select a mission</option>
                        {missions.map((mission) => (
                            <option key={mission.id} value={mission.id}>{mission.name}</option>
                        ))}
                    </>
                )}
            </select>
        </div>
    );
};
