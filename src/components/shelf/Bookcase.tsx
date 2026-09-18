import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/useTheme';
import { Raised } from '@/components/ui/Raised';

export function Bookcase({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <Raised offset={4} radius={8} style={style}>
      <View style={{ backgroundColor: c.caseBack, borderWidth: c.frameWidth, borderColor: c.frame, borderRadius: 8, overflow: 'hidden', paddingTop: 4 }}>
        {children}
      </View>
    </Raised>
  );
}
