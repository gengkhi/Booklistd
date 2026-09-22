import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { spineStyle } from '@/features/shelves/spineStyle';
import { font, radius } from '@/theme/palette';
import { easeOut, motion } from '@/theme/motion';
import { useTheme } from '@/theme/useTheme';

function Dots({ color }: { color: string }) {
  return (
    <Svg
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
      width="100%"
      height="100%"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <Pattern id="dots" width={5} height={5} patternUnits="userSpaceOnUse">
          <Circle cx={2.5} cy={2.5} r={0.9} fill={color} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#dots)" />
    </Svg>
  );
}

export function Spine({
  id, title, onPress, lean = 0, scale = 1, hidden, accessibilityActions, onAccessibilityAction,
}: {
  id: string; title: string; onPress?: () => void; lean?: number; scale?: number;
  /** Keeps the gap on the shelf while this spine is being dragged. */
  hidden?: boolean;
  accessibilityActions?: { name: string; label: string }[];
  onAccessibilityAction?: (e: { nativeEvent: { actionName: string } }) => void;
}) {
  const { c } = useTheme();
  const look = spineStyle(id, title);
  const w = Math.round(look.width * scale);
  const h = Math.round(look.height * scale);
  const lift = useSharedValue(0);
  const s = useAnimatedStyle(() => ({ transform: [{ translateY: -8 * lift.value }, { rotate: `${lean}deg` }] }));
  const to = (v: number, d: number) => () => {
    lift.value = withTiming(v, { duration: d, easing: easeOut });
  };
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      onPressIn={to(1, motion.feedback)}
      onPressOut={to(0, motion.routine)}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={title}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      hitSlop={{ top: 8, bottom: 8 }}
      style={{ marginLeft: lean ? 10 : 0 }}
    >
      <Animated.View
        style={[
          {
            width: w, height: h, backgroundColor: look.bg, borderWidth: 2, borderColor: c.line, borderRadius: radius.spine,
            overflow: 'hidden', alignItems: 'center', justifyContent: 'center', transformOrigin: 'bottom right',
          },
          hidden && { opacity: 0 },
          s,
        ]}
      >
        {look.pattern === 'dots' ? <Dots color={c.line} /> : null}
        {look.pattern === 'band' ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 12 * scale, height: 7, backgroundColor: look.accent, borderTopWidth: 2, borderBottomWidth: 2, borderColor: c.line }} />
        ) : null}
        {look.showTitle ? (
          <View style={{ width: h - 16, height: w, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '90deg' }] }}>
            {/* On dotted spines the title sits on a plain strip so the dots don't eat the letters. */}
            <Text
              numberOfLines={1}
              style={[
                { fontFamily: font.black, fontSize: 10.5 * scale, letterSpacing: 0.6, color: look.fg },
                look.pattern === 'dots' && { backgroundColor: look.bg, paddingHorizontal: 4 * scale, maxWidth: '100%' },
              ]}
            >
              {title.toUpperCase()}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}
