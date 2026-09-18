import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemePref } from '@/theme/resolveScheme';

interface SettingsState {
  theme: ThemePref;
  quiet: boolean; // "Quiet librarian": hides Dewey's lines and tape-note jokes
  setTheme: (theme: ThemePref) => void;
  setQuiet: (quiet: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      quiet: false,
      setTheme: (theme) => set({ theme }),
      setQuiet: (quiet) => set({ quiet }),
    }),
    { name: 'settings', storage: createJSONStorage(() => AsyncStorage) }
  )
);
