import React, { useEffect } from 'react';
import { Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing, interpolate, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import { font, ink } from '@/theme/palette';

/** Rubber stamp. When `play` turns true it slams down (420ms) and calls onLand at impact. */
export function Stamp({
  label, color = ink.tomato, play, delay = 0, onLand, style,
}: { label: string; color?: string; play: boolean; delay?: number; onLand?: () => void; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!play) {
      t.value = 0;
      return;
    }
    if (reduced) {
      t.value = withDelay(delay, withTiming(1, { duration: 1 }));
      if (onLand) setTimeout(onLand, delay);
      return;
    }
    t.value = 0;
    t.value = withDelay(
      delay,
      withTiming(1, { duration: 420, easing: Easing.bezier(0.2, 0.9, 0.25, 1) }, (done) => {
        if (done && onLand) runOnJS(onLand)();
      })
    );
  }, [play]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.3, 1], [0, 1, 1]),
    transform: [
      { scale: interpolate(t.value, [0, 0.45, 0.62, 1], [2.4, 0.92, 1.04, 1]) },
      { rotate: `${interpolate(t.value, [0, 0.45, 1], [-22, -8, -9])}deg` },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      accessible
      accessibilityLabel={label}
      style={[{ borderWidth: 2.5, borderColor: color, backgroundColor: ink.white, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 }, s, style]}
    >
      <Text style={{ fontFamily: font.display, fontSize: 19, color }}>{label}</Text>
    </Animated.View>
  );
}
