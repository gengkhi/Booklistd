import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { ink } from '@/theme/palette';

const SIZE = 250;
const corner = (pos: object, radii: object) => (
  <View style={[{ position: 'absolute', width: 44, height: 44, borderColor: ink.bus }, pos, radii]} />
);

/** Yellow corner viewfinder. The line roams until a code is read, then locks and the frame squeezes. */
export function ScanViewfinder({ locked }: { locked: boolean }) {
  const reduced = useReducedMotion();
  const y = useSharedValue(0.5);
  const squeeze = useSharedValue(1);

  useEffect(() => {
    if (locked) {
      cancelAnimation(y);
      if (reduced) {
        y.value = 0.62;
        squeeze.value = 1;
      } else {
        y.value = withTiming(0.62, { duration: 120 });
        squeeze.value = withSequence(withTiming(0.95, { duration: 120 }), withTiming(1, { duration: 160 }));
      }
    } else if (!reduced) {
      y.value = 0;
      y.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }), -1, true);
    }
  }, [locked, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const line = useAnimatedStyle(() => ({ transform: [{ translateY: 26 + y.value * (SIZE - 52) }] }));
  const frame = useAnimatedStyle(() => ({ transform: [{ scale: squeeze.value }] }));

  return (
    <Animated.View pointerEvents="none" style={[{ width: SIZE, height: SIZE }, frame]}>
      {corner({ left: 0, top: 0, borderLeftWidth: 5, borderTopWidth: 5 }, { borderTopLeftRadius: 14 })}
      {corner({ right: 0, top: 0, borderRightWidth: 5, borderTopWidth: 5 }, { borderTopRightRadius: 14 })}
      {corner({ left: 0, bottom: 0, borderLeftWidth: 5, borderBottomWidth: 5 }, { borderBottomLeftRadius: 14 })}
      {corner({ right: 0, bottom: 0, borderRightWidth: 5, borderBottomWidth: 5 }, { borderBottomRightRadius: 14 })}
      <Animated.View style={[{ position: 'absolute', left: 14, right: 14, height: 4, borderRadius: 3, backgroundColor: ink.bus, borderWidth: 1.5, borderColor: ink.brown }, line]} />
    </Animated.View>
  );
}
