import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      hitSlop={{ top: 7, bottom: 7 }}
      style={({ pressed }) => ({ transform: [{ translateY: pressed ? 1 : 0 }] })}
    >
      <View
        style={{
          height: 32, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 2, borderColor: c.line,
          backgroundColor: selected ? ink.brown : ink.white, alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: font.heavy, fontSize: 12.5, color: selected ? ink.white : ink.brown }}>{label}</Text>
      </View>
    </Pressable>
  );
}
