import React from 'react';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { ink } from '@/theme/palette';

/** "Forever shelf": a warm glow swells behind Dewey — enshrined. Render it *behind* Dewey. */
export function GoldenGlow({ p, size }: { p: SharedValue<number>; size: number }) {
  const d = size * 1.3;
  const glow = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.25, 0.6, 1], [0, 0.55, 0.35, 0.25], 'clamp'),
    transform: [{ scale: interpolate(p.value, [0, 0.3, 0.7, 1], [0.4, 1, 1.2, 1.15], 'clamp') }],
  }));
  const ring = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.3, 1], [0, 0.9, 0], 'clamp'),
    transform: [{ scale: interpolate(p.value, [0, 1], [0.6, 1.5], 'clamp') }],
  }));
  const base = { position: 'absolute' as const, width: d, height: d, borderRadius: d / 2, left: '50%' as const, marginLeft: -d / 2, bottom: -d * 0.12 };
  return (
    <>
      <Animated.View style={[base, { backgroundColor: ink.bus }, glow]} />
      <Animated.View style={[base, { borderWidth: 3, borderColor: ink.bus }, ring]} />
    </>
  );
}
