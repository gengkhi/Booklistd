import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { BagelFatOne_400Regular } from '@expo-google-fonts/bagel-fat-one';
import { Figtree_600SemiBold, Figtree_700Bold, Figtree_800ExtraBold, Figtree_900Black } from '@expo-google-fonts/figtree';
import { GochiHand_400Regular } from '@expo-google-fonts/gochi-hand';
import { QueryProvider } from '@/providers/QueryProvider';
import { getDb } from '@/db/database';
import { useTheme } from '@/theme/useTheme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { scheme, c } = useTheme();
  const [fontsLoaded] = useFonts({
    BagelFatOne_400Regular,
    Figtree_600SemiBold, Figtree_700Bold, Figtree_800ExtraBold, Figtree_900Black,
    GochiHand_400Regular,
  });

  useEffect(() => {
    getDb(); // open + migrate on launch
  }, []);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <QueryProvider>
      <StatusBar style={scheme === 'lamp' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.paper } }} />
    </QueryProvider>
  );
}
