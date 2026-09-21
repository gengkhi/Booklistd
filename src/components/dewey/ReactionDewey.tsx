import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing, interpolate, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming,
} from 'react-native-reanimated';
import { reactionFor } from '@/features/rating/reactions';
import { fireHaptic } from '@/features/rating/haptics';
import { motion, popSpring } from '@/theme/motion';
import { Dewey } from './Dewey';
import { GoldenGlow } from './flourishes/GoldenGlow';
import { SparkleBurst } from './flourishes/SparkleBurst';
import { Tissue } from './flourishes/Tissue';

const FLOURISH_DELAY = 200;
const FLOURISH_MS = 800;

/** Dewey reacting to a rating: spring pop + that reaction's flourish + haptic. Bump playKey to replay. */
export function ReactionDewey({ rating, playKey, size = 110 }: { rating: number | null; playKey: number; size?: number }) {
  const reduced = useReducedMotion();
  const r = reactionFor(rating);
  const flourish = r?.flourish ?? null;
  const pop = useSharedValue(1);
  const p = useSharedValue(0);

  useEffect(() => {
    if (!r || playKey === 0) return;
    fireHaptic(r.haptic);
    pop.value = 0;
    p.value = 0;
    if (reduced) {
      pop.value = withTiming(1, { duration: motion.routine });
      return;
    }
    pop.value = withSpring(1, popSpring);
    p.value = withDelay(FLOURISH_DELAY, withTiming(1, { duration: FLOURISH_MS, easing: Easing.linear }));
  }, [playKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const popStyle = useAnimatedStyle(() =>
    reduced
      ? { opacity: pop.value }
      : { opacity: pop.value > 0.05 ? 1 : 0, transform: [{ translateY: (1 - pop.value) * 30 }, { scale: 0.6 + 0.4 * pop.value }] }
  );
  const bodyStyle = useAnimatedStyle(() => {
    if (flourish === 'headTilt') return { transform: [{ rotate: `${interpolate(p.value, [0, 0.2, 0.45, 0.7, 1], [0, -10, 8, -5, 0])}deg` }] };
    if (flourish === 'happyBounce') return { transform: [{ translateY: interpolate(p.value, [0, 0.15, 0.3, 0.42, 0.55, 1], [0, -12, 0, -6, 0, 0]) }] };
    return { transform: [] };
  });
  const pupil = useDerivedValue(() => (flourish === 'eyeRoll' ? interpolate(p.value, [0, 0.25, 0.6, 0.85, 1], [0, 1, 1, 0, 0]) : 0));
  const blush = useDerivedValue(() => (flourish === 'happyBounce' ? interpolate(p.value, [0, 0.15], [0, 0.8], 'clamp') : 0));
  const motionOn = !reduced && !!r;

  return (
    <View style={{ width: size * 1.8, height: size * 1.4, alignItems: 'center', justifyContent: 'flex-end' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {motionOn && flourish === 'goldenGlow' ? <GoldenGlow p={p} size={size} /> : null}
      <Animated.View style={popStyle}>
        <Animated.View style={[{ transformOrigin: 'bottom' }, bodyStyle]}>
          <Dewey mood={r?.mood ?? 'happy'} size={size} pupil={pupil} blush={flourish === 'happyBounce' ? blush : undefined} />
        </Animated.View>
      </Animated.View>
      {motionOn && flourish === 'sparkleBurst' ? <SparkleBurst p={p} size={size} /> : null}
      {motionOn && flourish === 'tissue' ? <Tissue p={p} size={size} /> : null}
    </View>
  );
}
