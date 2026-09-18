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

/**
 * True once persisted settings have been read, whether that worked or not. zustand's
 * hasHydrated/onFinishHydration never fire when storage rejects or the JSON is corrupt,
 * so the splash gate listens to this instead.
 */
export const useSettingsReady = create<boolean>()(() => false);

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      quiet: false,
      setTheme: (theme) => set({ theme }),
      setQuiet: (quiet) => set({ quiet }),
    }),
    {
      name: 'settings',
      storage: createJSONStorage(() => AsyncStorage),
      // The returned callback runs after rehydration on success AND on error.
      onRehydrateStorage: () => () => useSettingsReady.setState(true, true),
    }
  )
);
