import React from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';
import { Raised } from './Raised';

/** Library pocket card: white card, tomato top rule, dotted-leader rows. Replaces stat grids. */
export function PocketCard({ title, children, style }: { title?: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <Raised offset={3} radius={radius.card} style={style}>
      <View style={{ backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, borderRadius: radius.card, overflow: 'hidden' }}>
        <View style={{ height: 9, backgroundColor: ink.tomato, borderBottomWidth: 2, borderColor: c.line }} />
        <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8 }}>
          {title ? (
            <Text style={{ fontFamily: font.black, fontSize: 11, letterSpacing: 0.4, color: ink.soft, marginBottom: 2 }}>
              {title.toUpperCase()}
            </Text>
          ) : null}
          {children}
        </View>
      </View>
    </Raised>
  );
}

export function LeaderRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingVertical: 4 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={{ fontFamily: font.bold, fontSize: 14, color: ink.brown }}>{label}</Text>
      <Text numberOfLines={1} ellipsizeMode="clip" style={{ flex: 1, marginHorizontal: 6, color: ink.soft, fontFamily: font.black, fontSize: 12 }}>
        {' · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·'}
      </Text>
      <Text style={{ fontFamily: font.black, fontSize: 14, color: ink.brown }}>{value}</Text>
    </View>
  );
}
