import React from 'react';
import { Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { font, ink } from '@/theme/palette';
import { easeOut, motion } from '@/theme/motion';
import { useTheme } from '@/theme/useTheme';
import { Raised } from './Raised';

/** Dewey's speech bubble. Re-keys on text so each new line scales in. */
export function Bubble({ text, width = 150, style }: { text: string; width?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <Animated.View key={text} entering={ZoomIn.duration(motion.routine).easing(easeOut)} style={[{ width }, style]} accessibilityLiveRegion="polite">
      <Raised offset={3} radius={14}>
        <Animated.View style={{ backgroundColor: ink.white, borderWidth: 2, borderColor: c.line, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 12, lineHeight: 16, color: ink.brown }}>{text}</Text>
        </Animated.View>
      </Raised>
    </Animated.View>
  );
}
