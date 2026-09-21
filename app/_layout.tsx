import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { BagelFatOne_400Regular } from '@expo-google-fonts/bagel-fat-one';
import { Figtree_600SemiBold, Figtree_700Bold, Figtree_800ExtraBold, Figtree_900Black } from '@expo-google-fonts/figtree';
import { GochiHand_400Regular } from '@expo-google-fonts/gochi-hand';
import { QueryProvider } from '@/providers/QueryProvider';
import { getDb } from '@/db/database';
import { useSettingsReady } from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';

SplashScreen.preventAutoHideAsync();

const SETTINGS_WAIT_MS = 1500;

export default function RootLayout() {
  const { scheme, c } = useTheme();
  const [fontsLoaded] = useFonts({
    BagelFatOne_400Regular,
    Figtree_600SemiBold, Figtree_700Bold, Figtree_800ExtraBold, Figtree_900Black,
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
  }, []);

  const ready = fontsLoaded && hydrated;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryProvider>
        <StatusBar style={scheme === 'lamp' ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.paper } }}>
          <Stack.Screen name="book/edit" options={{ presentation: 'modal' }} />
          <Stack.Screen name="shelves" />
        </Stack>
      </QueryProvider>
    </GestureHandlerRootView>
  );
}
