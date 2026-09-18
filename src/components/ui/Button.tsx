import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { font, ink, radius } from '@/theme/palette';
import { easeOut, motion } from '@/theme/motion';
import { useTheme } from '@/theme/useTheme';

const OFFSET = 3;

export function Button({
  label, onPress, variant = 'primary', disabled, flex, accessibilityLabel,
}: { label: string; onPress: () => void; variant?: 'primary' | 'ghost'; disabled?: boolean; flex?: boolean; accessibilityLabel?: string }) {
  const { c } = useTheme();
  const press = useSharedValue(0);
  const face = useAnimatedStyle(() => ({
    transform: [{ translateX: press.value * OFFSET }, { translateY: press.value * OFFSET }],
  }));
  const sink = (to: number) => () => {
    press.value = withTiming(to, { duration: motion.feedback, easing: easeOut });
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={sink(1)}
      onPressOut={sink(0)}
      style={{ flex: flex ? 1 : undefined, opacity: disabled ? 0.45 : 1, paddingRight: OFFSET, paddingBottom: OFFSET }}
    >
      <View style={{ position: 'absolute', left: OFFSET, top: OFFSET, right: 0, bottom: 0, borderRadius: radius.button, backgroundColor: c.line }} />
      <Animated.View
        style={[
          {
            height: 52, borderRadius: radius.button, borderWidth: 2.5, borderColor: c.line,
            backgroundColor: variant === 'primary' ? ink.bus : ink.white,
            alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
          },
          face,
        ]}
      >
        <Text style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}
