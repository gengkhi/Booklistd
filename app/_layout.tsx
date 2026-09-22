import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { BagelFatOne_400Regular } from '@expo-google-fonts/bagel-fat-one';
// Per-weight imports: the package root requires all 14 Figtree files, and Metro would ship every one.
import { Figtree_700Bold } from '@expo-google-fonts/figtree/700Bold';
import { Figtree_800ExtraBold } from '@expo-google-fonts/figtree/800ExtraBold';
import { Figtree_900Black } from '@expo-google-fonts/figtree/900Black';
import { GochiHand_400Regular } from '@expo-google-fonts/gochi-hand';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { QueryProvider, queryClient } from '@/providers/QueryProvider';
import { startSync } from '@/sync/engine';
import { UndoToast } from '@/components/ui/UndoToast';
import { getDb } from '@/db/database';
import { routeGuards, startSessionListener, useSession } from '@/auth/session';
import { useSettingsReady } from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';

SplashScreen.preventAutoHideAsync();

const SETTINGS_WAIT_MS = 1500;

export default function RootLayout() {
  const { scheme, c } = useTheme();
  const [fontsLoaded] = useFonts({
    BagelFatOne_400Regular,
    Figtree_700Bold, Figtree_800ExtraBold, Figtree_900Black,
    GochiHand_400Regular,
  });

  // Wait for persisted settings too, so a Lamplight user never sees a Daylight flash,
  // but never block launch on them: storage errors still flip ready, and a timeout backs that up.
  const settingsReady = useSettingsReady();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), SETTINGS_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  const hydrated = settingsReady || gaveUp;

  useEffect(() => {
    getDb(); // open + migrate on launch
    return startSessionListener();
  }, []);

  // Pulled rows change what every library query shows.
  useEffect(() => startSync({ onPulled: () => invalidateLibrary(queryClient) }), []);

  // Never blocks on auth: a phone with a library owner opens at once (sync paused until the session refreshes);
  // without one the splash waits for Supabase, capped at AUTH_WAIT_MS, so signed-out people never glimpse the tabs.
  const status = useSession((s) => s.status);
  const guards = routeGuards(status);
  const ready = fontsLoaded && hydrated && status !== 'loading';
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryProvider>
        <StatusBar style={scheme === 'lamp' ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.paper } }}>
          <Stack.Protected guard={guards.app}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="book/[id]" />
            <Stack.Screen name="book/edit" options={{ presentation: 'modal' }} />
            <Stack.Screen name="reading" />
            <Stack.Screen name="shelves" />
            <Stack.Screen name="account/delete" />
            <Stack.Screen name="account/rejects" />
          </Stack.Protected>
          <Stack.Protected guard={guards.welcome}>
            <Stack.Screen name="welcome" />
          </Stack.Protected>
          <Stack.Screen name="auth/callback" />
        </Stack>
        <UndoToast />
      </QueryProvider>
    </GestureHandlerRootView>
  );
}
