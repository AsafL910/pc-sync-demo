import { create } from 'zustand';

interface UIState {
    toast: string | null;
    showToast: (msg: string, duration?: number) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
    toast: null,
    showToast: (msg, duration = 3000) => {
        set({ toast: msg });
        setTimeout(() => {
            if (get().toast === msg) set({ toast: null });
        }, duration);
    },
}));
