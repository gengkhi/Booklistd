import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { ink } from '@/theme/palette';

export function Plant({ size = 34 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 34 34" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M9 22h16l-2 11H11z" fill={ink.tomato} stroke={ink.brown} strokeWidth={2} />
      <Path d="M17 22c0-8-6-12-10-12 0 6 4 10 10 12zM17 22c0-10 6-15 11-15 0 7-5 13-11 15z" fill={ink.grass} stroke={ink.brown} strokeWidth={2} />
    </Svg>
  );
}
