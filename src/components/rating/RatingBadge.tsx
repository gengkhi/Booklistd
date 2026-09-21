import React from 'react';
import { Pressable, Text } from 'react-native';
import { reactionFor } from '@/features/rating/reactions';
import { Dewey } from '@/components/dewey/Dewey';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** The rating on book detail: a still Dewey face + its label. Tap to change it. */
export function RatingBadge({ rating, onPress }: { rating: number; onPress: () => void }) {
  const { c } = useTheme();
  const r = reactionFor(rating);
  if (!r) return null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Your rating: ${r.label}. Tap to change.`}
      style={{
        height: 32, paddingLeft: 4, paddingRight: 12, borderRadius: radius.pill, borderWidth: 2, borderColor: c.line,
        backgroundColor: ink.white, flexDirection: 'row', alignItems: 'center', gap: 4,
      }}
    >
      <Dewey mood={r.mood} size={26} still />
      <Text style={{ fontFamily: font.heavy, fontSize: 12.5, color: ink.brown }}>{r.label}</Text>
    </Pressable>
  );
}
