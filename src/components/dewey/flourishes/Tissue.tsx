import React from 'react';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { ink } from '@/theme/palette';

/** "Wrecked me (nicely)": a tissue floats down from nowhere and lands by Dewey. */
export function Tissue({ p, size }: { p: SharedValue<number>; size: number }) {
  const k = size / 110;
  const s = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.1], [0, 1], 'clamp'),
    transform: [
      { translateX: interpolate(p.value, [0, 0.35, 0.6, 1], [20, -8, 4, 4], 'clamp') * k },
      { translateY: interpolate(p.value, [0, 0.35, 0.6, 1], [-90, -48, -12, -12], 'clamp') * k },
      { rotate: `${interpolate(p.value, [0, 0.35, 0.6, 1], [-20, 15, -6, -6], 'clamp')}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[{
        position: 'absolute', left: '50%', bottom: size * 0.3, marginLeft: -11 * k, width: 22 * k, height: 18 * k,
        backgroundColor: ink.white, borderWidth: 2, borderColor: ink.brown,
        borderTopLeftRadius: 3, borderTopRightRadius: 8, borderBottomLeftRadius: 8, borderBottomRightRadius: 3,
      }, s]}
    />
  );
}
