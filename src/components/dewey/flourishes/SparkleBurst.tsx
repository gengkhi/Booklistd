import React from 'react';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { ink } from '@/theme/palette';

const SPARKS = [
  { dx: -50, dy: -30, color: ink.bus },
  { dx: 46, dy: -36, color: ink.bus },
  { dx: -30, dy: -54, color: ink.tomato },
  { dx: 30, dy: -58, color: ink.pool },
];

function Spark({ p, dx, dy, color, k }: { p: SharedValue<number>; dx: number; dy: number; color: string; k: number }) {
  const s = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.05, 0.6, 0.9], [0, 1, 1, 0], 'clamp'),
    transform: [
      { translateX: interpolate(p.value, [0, 0.7], [0, dx * k], 'clamp') },
      { translateY: interpolate(p.value, [0, 0.7], [0, dy * k], 'clamp') },
      { scale: interpolate(p.value, [0, 0.3, 0.7], [0.4, 1.3, 1], 'clamp') },
    ],
  }));
  return <Animated.Text style={[{ position: 'absolute', left: '50%', top: '38%', marginLeft: -7, fontSize: 18 * k, color }, s]}>✦</Animated.Text>;
}

/** "Couldn't put it down": sparkles fly out from Dewey. */
export function SparkleBurst({ p, size }: { p: SharedValue<number>; size: number }) {
  const k = size / 110;
  return <>{SPARKS.map((s, i) => <Spark key={i} p={p} k={k} {...s} />)}</>;
}
