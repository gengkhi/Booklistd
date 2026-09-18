import React from 'react';
import { Image, Text, View } from 'react-native';
import { colors, font } from '@/theme/tokens';

const SPINE_COLORS = ['#B3543A', '#33507A', '#3E5F45', '#7C2C2C', '#35426B', '#9A742A', '#2F6161', '#4A3A5E'];

export function BookCover({
  title,
  author,
  coverUrl,
  width = 100,
  height = 144,
}: {
  title: string;
  author?: string;
  coverUrl?: string | null;
  width?: number;
  height?: number;
}) {
  const bg = SPINE_COLORS[Math.abs(hash(title)) % SPINE_COLORS.length];
  if (coverUrl) {
    return (
      <Image
        source={{ uri: coverUrl }}
        style={{ width, height, borderRadius: 6, backgroundColor: bg }}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={{
        width,
        height,
        backgroundColor: bg,
        borderTopLeftRadius: 4,
        borderBottomLeftRadius: 4,
        borderTopRightRadius: 9,
        borderBottomRightRadius: 9,
        borderLeftWidth: 5,
        borderLeftColor: 'rgba(30,20,10,0.3)',
        padding: 10,
        justifyContent: 'space-between',
      }}
    >
      <Text style={{ fontFamily: font.displaySemi, fontSize: 13, color: colors.onAccent }} numberOfLines={3}>
        {title}
      </Text>
      {author ? (
        <Text style={{ fontSize: 8, letterSpacing: 0.6, color: colors.onAccent, opacity: 0.9 }} numberOfLines={1}>
          {author.toUpperCase()}
        </Text>
      ) : null}
    </View>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}
