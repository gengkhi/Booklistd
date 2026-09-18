import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import Animated, {
  useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSpring, withTiming,
} from 'react-native-reanimated';
import { font, ink } from '@/theme/palette';
import { popSpring } from '@/theme/motion';

export type DeweyMood = 'happy' | 'smug' | 'gasp' | 'sleep';
const INK = ink.brown;

function Face({ mood }: { mood: DeweyMood }) {
  const eyes =
    mood === 'sleep' ? (
      <Path d="M40 34h6M55 34h6" stroke={INK} strokeWidth={2.5} />
    ) : mood === 'smug' ? (
      <Path d="M39 33h8M54 33h8" stroke={INK} strokeWidth={3} />
    ) : (
      <>
        <Circle cx={44} cy={34} r={2.2} fill={INK} />
        <Circle cx={59} cy={34} r={2.2} fill={INK} />
      </>
    );
  const mouth =
    mood === 'gasp' ? <Ellipse cx={51} cy={46} rx={3.2} ry={4} fill={INK} /> : <Path d="M46 45q5 3 10 0" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" />;
  return (
    <>
      {eyes}
      {mouth}
    </>
  );
}

function Zzz() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 2600 }), -1, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useAnimatedStyle(() => ({
    opacity: t.value < 0.3 ? t.value / 0.3 : 1 - (t.value - 0.3) / 0.7,
    transform: [{ translateX: 14 * t.value }, { translateY: -26 * t.value }],
  }));
  return <Animated.Text style={[{ position: 'absolute', right: 6, top: -4, fontFamily: font.display, fontSize: 16, color: ink.bus }, s]}>z</Animated.Text>;
}

/** Dewey the bookworm. Roasts the library, never the owner. */
export function Dewey({
  mood = 'happy', size = 64, pop, popDelay = 0, onPress,
}: { mood?: DeweyMood; size?: number; pop?: boolean; popDelay?: number; onPress?: () => void }) {
  const reduced = useReducedMotion();
  const k = useSharedValue(pop && !reduced ? 0 : 1);
  useEffect(() => {
    if (pop && !reduced) k.value = withDelay(popDelay, withSpring(1, popSpring));
  }, [pop]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useAnimatedStyle(() => ({
    opacity: k.value > 0.05 ? 1 : 0,
    transform: [{ translateY: (1 - k.value) * 40 }, { scale: 0.6 + 0.4 * k.value }],
  }));
  const body = (
    <Svg width={size} height={size * 0.95} viewBox="0 0 74 70">
      <G stroke={INK} strokeWidth={2.5}>
        <Circle cx={20} cy={56} r={11} fill={ink.grass} />
        <Circle cx={34} cy={50} r={12} fill={ink.grass} />
        <Circle cx={50} cy={36} r={17} fill={ink.grass} />
        <Circle cx={43} cy={33} r={6.5} fill={ink.white} />
        <Circle cx={58} cy={33} r={6.5} fill={ink.white} />
      </G>
      <Path d="M49.5 33h2" stroke={INK} strokeWidth={2.5} />
      <Face mood={mood} />
      <Path d="M47 19q-2-8 4-11" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </Svg>
  );
  return (
    <Animated.View style={s}>
      {mood === 'sleep' && !reduced ? <Zzz /> : null}
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Dewey the bookworm. Tap for another remark." hitSlop={8}>
          {body}
        </Pressable>
      ) : (
        body
      )}
    </Animated.View>
  );
}
