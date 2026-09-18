import React from 'react';
import { Text } from 'react-native';
import Animated, { FadeOut, SlideInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';
import { Raised } from './Raised';

export function Toast({ text }: { text: string | null }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  if (!text) return null;
  return (
    <Animated.View
      key={text}
      entering={SlideInUp.duration(380)}
      exiting={FadeOut.duration(200)}
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: 20, right: 20, top: insets.top + 60, zIndex: 50 }}
    >
      <Raised offset={3} radius={14}>
        <Animated.View style={{ backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, borderRadius: 14, padding: 13 }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 14, color: ink.brown }}>{text}</Text>
        </Animated.View>
      </Raised>
    </Animated.View>
  );
}
