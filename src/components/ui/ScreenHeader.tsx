import React from 'react';
import { Text, View } from 'react-native';
import { font } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export function ScreenHeader({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
      {kicker ? <Text style={{ fontFamily: font.bold, fontSize: 14, color: c.soft }}>{kicker}</Text> : null}
      <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 40, lineHeight: 44, color: c.text }}>{title}</Text>
      {sub ? <Text style={{ fontFamily: font.bold, fontSize: 13, color: c.soft, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}
