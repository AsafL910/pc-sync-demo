import { useUIStore } from '../store/useUIStore';

export const useUIActions = () => {
    const setToast = useUIStore((state) => state.setToast);
    const toast = useUIStore((state) => state.toast);

    const showToast = (msg: string, duration = 3000) => {
        setToast(msg);
        setTimeout(() => {
            // Only clear if the toast hasn't been changed by another call
            if (useUIStore.getState().toast === msg) {
                setToast(null);
            }
        }, duration);
    };

    return { showToast, toast };
};
