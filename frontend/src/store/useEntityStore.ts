import { create } from 'zustand';
import { useUIStore } from './useUIStore';
import { DB_SYNC_URL } from '../context/NATSContext';

interface EntityState {
    createEntity: (missionId: string) => Promise<boolean>;
    updateEntityVersion: (entityId: string) => Promise<boolean>;
    deleteEntity: (entityId: string) => Promise<boolean>;
}

export const useEntityStore = create<EntityState>(() => ({
    createEntity: async (missionId) => {
        const { showToast } = useUIStore.getState();
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
    },
    updateEntityVersion: async (entityId) => {
        const { showToast } = useUIStore.getState();
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
    },
    deleteEntity: async (entityId) => {
        const { showToast } = useUIStore.getState();
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
    },
}));
