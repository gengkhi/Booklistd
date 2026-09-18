import React from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { font, ink } from '@/theme/palette';

export function TapeNote({ text, style }: { text: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ backgroundColor: ink.tape, paddingHorizontal: 10, paddingVertical: 1, transform: [{ rotate: '-2deg' }] }, style]}>
      <Text style={{ fontFamily: font.hand, fontSize: 15, color: ink.brown }} numberOfLines={1}>{text}</Text>
    </View>
  );
}
