import React, { useEffect } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { font, ink } from '@/theme/palette';
import { popSpring } from '@/theme/motion';
import { useTheme } from '@/theme/useTheme';

/** Round yellow sticker. With `play`, it slaps on with a spring. */
export function Sticker({
  label, size = 62, play = true, delay = 0, style,
}: { label: string; size?: number; play?: boolean; delay?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  const k = useSharedValue(play && !reduced ? 0 : 1);
  useEffect(() => {
    if (play && !reduced) k.value = withDelay(delay, withSpring(1, popSpring));
  }, [play]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useAnimatedStyle(() => ({ transform: [{ rotate: '14deg' }, { scale: k.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ width: size + 3, height: size + 3 }, s, style]}>
      <View style={{ position: 'absolute', left: 3, top: 3, width: size, height: size, borderRadius: size / 2, backgroundColor: c.line }} />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: ink.bus, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: font.display, fontSize: size / 3.9, color: ink.brown, textAlign: 'center' }}>{label}</Text>
      </View>
    </Animated.View>
  );
}
