import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import Animated, {
  useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSpring, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { ReactionMood } from '@/features/rating/reactions';
import { font, ink } from '@/theme/palette';
import { popSpring } from '@/theme/motion';

export type DeweyMood = 'happy' | 'smug' | 'gasp' | 'sleep' | ReactionMood;
const INK = ink.brown;

const ACircle = Animated.createAnimatedComponent(Circle);
const AEllipse = Animated.createAnimatedComponent(Ellipse);

function starPath(cx: number, cy: number, R = 4.8, r = 2.1) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    d += `${i ? 'L' : 'M'}${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
}
const STARS = `${starPath(43, 33)}${starPath(58, 33)}`;
const FLAT_MOUTH = 'M46 46h10';
const SMILE = 'M46 45q5 3 10 0';
const HAPPY_CLOSED = 'M40 35q3-3 6 0M55 35q3-3 6 0';

/** Eye-roll pupils: pupil 0 = looking ahead, 1 = rolled up under the lids. */
function MehEyes({ pupil }: { pupil?: SharedValue<number> }) {
  const left = useAnimatedProps(() => ({ cy: 35 - 4 * (pupil?.value ?? 0) }));
  const right = useAnimatedProps(() => ({ cy: 35 - 4 * (pupil?.value ?? 0) }));
  return (
    <>
      <ACircle cx={43} r={2.2} fill={INK} animatedProps={left} />
      <ACircle cx={58} r={2.2} fill={INK} animatedProps={right} />
      <Path d="M37.5 30.5h11M52.5 30.5h11" stroke={INK} strokeWidth={2.5} />
    </>
  );
}

function Blush({ blush }: { blush: SharedValue<number> }) {
  const p = useAnimatedProps(() => ({ opacity: blush.value }));
  return (
    <>
      <AEllipse cx={39} cy={42} rx={3.6} ry={2} fill={ink.tomato} animatedProps={p} />
      <AEllipse cx={62} cy={42} rx={3.6} ry={2} fill={ink.tomato} animatedProps={p} />
    </>
  );
}

function Face({ mood, pupil }: { mood: DeweyMood; pupil?: SharedValue<number> }) {
  const dots = (dx = 0) => (
    <>
      <Circle cx={44 + dx} cy={34} r={2.2} fill={INK} />
      <Circle cx={59 + dx} cy={34} r={2.2} fill={INK} />
    </>
  );
  const line = (d: string) => <Path d={d} stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" />;
  switch (mood) {
    case 'sleep':
      return <><Path d="M40 34h6M55 34h6" stroke={INK} strokeWidth={2.5} />{line(SMILE)}</>;
    case 'smug':
      return <><Path d="M39 33h8M54 33h8" stroke={INK} strokeWidth={2.5} />{line(SMILE)}</>;
    case 'gasp':
      return <>{dots()}<Ellipse cx={51} cy={46} rx={3.2} ry={4} fill={INK} /></>;
    case 'bored':
      return <>{line('M40 34h6M55 34h6')}{line(FLAT_MOUTH)}</>;
    case 'meh':
      return <><MehEyes pupil={pupil} />{line(FLAT_MOUTH)}</>;
    case 'hmm':
      return <>{dots(2)}{line('M46 46q5-2 10 1')}</>;
    case 'starry':
      return <><Path d={STARS} fill={ink.bus} stroke={INK} strokeWidth={1} /><Ellipse cx={51} cy={46} rx={3.2} ry={4} fill={INK} /></>;
    case 'teary':
      return <>{line(HAPPY_CLOSED)}{line('M46 45q5 4 10 0')}<Path d="M42 40v4M63 40v4" stroke={ink.pool} strokeWidth={2.5} strokeLinecap="round" /></>;
    case 'smitten':
      return (
        <>
          {line(HAPPY_CLOSED)}
          <Rect x={36} y={46} width={30} height={20} rx={2} fill={ink.tomato} stroke={INK} strokeWidth={2.5} />
          <Path d="M51 46v20" stroke={INK} strokeWidth={2} />
        </>
      );
    case 'happy':
    default:
      return <>{dots()}{line(SMILE)}</>;
  }
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
  mood = 'happy', size = 64, pop, popDelay = 0, onPress, still, pupil, blush,
}: {
  mood?: DeweyMood; size?: number; pop?: boolean; popDelay?: number; onPress?: () => void;
  still?: boolean; pupil?: SharedValue<number>; blush?: SharedValue<number>;
}) {
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
      <Face mood={mood} pupil={pupil} />
      {blush ? <Blush blush={blush} /> : null}
      <Path d="M47 19q-2-8 4-11" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </Svg>
  );
  return (
    <Animated.View style={s}>
      {(mood === 'sleep' || mood === 'bored') && !reduced && !still ? <Zzz /> : null}
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
