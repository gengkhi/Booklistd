/** Local-only UI state (Zustand) — server/db state lives in TanStack Query + repository. */
import { create } from 'zustand';

interface ScanSessionState {
  storeMode: boolean;
  toggleStoreMode: () => void;
}

export const useScanSession = create<ScanSessionState>((set) => ({
  storeMode: true,
  toggleStoreMode: () => set((s) => ({ storeMode: !s.storeMode })),
}));
