import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/useTheme';

/** Hard offset shadow drawn as a real layer — Android elevation cannot do hard offsets. */
export function Raised({
  offset = 3, radius = 14, shadowColor, style, children,
}: { offset?: number; radius?: number; shadowColor?: string; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={[{ paddingRight: offset, paddingBottom: offset }, style]}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: offset, top: offset, right: 0, bottom: 0, borderRadius: radius, backgroundColor: shadowColor ?? c.line }}
      />
      {children}
    </View>
  );
}
