import { useUIActions } from './useUIActions';
import { DB_SYNC_URL } from '../context/NATSContext';

export const useEntityActions = () => {
    const { showToast } = useUIActions();

    const createEntity = async (missionId: string): Promise<boolean> => {
        try {
            const res = await fetch(`${DB_SYNC_URL}/entities`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mission_id: missionId })
            });
            if (res.ok) {
                showToast('📍 Entity added to mission');
                return true;
            }
            const error = await res.json().catch(() => null);
            showToast(`❌ Error: ${error?.error || 'Failed to create entity'}`);
            return false;
        } catch (e: any) {
            showToast(`❌ Error: ${e.message}`);
            return false;
        }
    };

    const updateEntityVersion = async (entityId: string): Promise<boolean> => {
        try {
            const res = await fetch(`${DB_SYNC_URL}/entities/${entityId}/version`, { method: 'PATCH' });
            if (res.ok) return true;
            const error = await res.json().catch(() => null);
            showToast(`❌ Error: ${error?.error || 'Failed to update'}`);
            return false;
        } catch (e: any) {
            showToast(`❌ Error: ${e.message}`);
            return false;
        }
    };

    const deleteEntity = async (entityId: string): Promise<boolean> => {
        try {
            const res = await fetch(`${DB_SYNC_URL}/entities/${entityId}`, { method: 'DELETE' });
            if (res.ok) return true;
            const error = await res.json().catch(() => null);
            showToast(`❌ Error: ${error?.error || 'Failed to delete'}`);
            return false;
        } catch (e: any) {
            showToast(`❌ Error: ${e.message}`);
            return false;
        }
    };

    return {
        createEntity,
        updateEntityVersion,
        deleteEntity
    };
};
