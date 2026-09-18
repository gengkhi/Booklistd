import React from 'react';
import { Image, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { spineStyle } from '@/features/shelves/spineStyle';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** Real cover when we have one; otherwise a flat picture-book cover in the book's spine colors. */
export function CoverArt({
  id, title, author, coverUrl, width, height,
}: { id: string; title: string; author?: string; coverUrl?: string | null; width: number; height: number }) {
  const { c } = useTheme();
  const frame = { width, height, borderWidth: 2.5, borderColor: c.line, borderTopLeftRadius: 3, borderBottomLeftRadius: 3, borderTopRightRadius: 6, borderBottomRightRadius: 6, overflow: 'hidden' as const };
  if (coverUrl) {
    return <Image source={{ uri: coverUrl }} style={frame} resizeMode="cover" accessibilityLabel={`Cover of ${title}`} />;
  }
  const look = spineStyle(id, title);
  return (
    <View style={[frame, { backgroundColor: look.bg, padding: width * 0.09 }]} accessibilityLabel={`Cover of ${title}`}>
      <Svg
        style={{ position: 'absolute', left: 0, top: 0 }}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Path d={`M0 ${height * 0.62} Q${width * 0.3} ${height * 0.5} ${width * 0.55} ${height * 0.6} T${width} ${height * 0.55} V${height} H0Z`} fill={look.accent} stroke={ink.brown} strokeWidth={2} />
        <Path d={`M0 ${height * 0.76} Q${width * 0.4} ${height * 0.68} ${width} ${height * 0.74} V${height} H0Z`} fill={look.bg === ink.tomato ? ink.pool : ink.tomato} stroke={ink.brown} strokeWidth={2} />
        <Circle cx={width * 0.74} cy={height * 0.32} r={width * 0.11} fill={ink.paper} stroke={ink.brown} strokeWidth={2} />
      </Svg>
      <Text numberOfLines={3} style={{ fontFamily: font.display, fontSize: Math.max(10, width / 6.5), lineHeight: Math.max(12, width / 5.6), color: look.fg }}>{title}</Text>
      {author && width >= 90 ? <Text numberOfLines={1} style={{ fontFamily: font.heavy, fontSize: width / 15, color: look.fg, marginTop: 2 }}>{author}</Text> : null}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, borderRightWidth: 2, borderColor: ink.brown }} />
    </View>
  );
}
