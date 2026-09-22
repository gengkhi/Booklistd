import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeOut, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '@/stores/toast';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';
import { Raised } from './Raised';

/** App-wide toast (bottom), with an optional Undo. Mounted once in the root layout. */
export function UndoToast() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { message, onUndo, undo } = useToast();
  if (!message) return null;
  return (
    <Animated.View key={message} entering={SlideInDown.duration(300)} exiting={FadeOut.duration(200)} accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 100, zIndex: 100 }}>
      <Raised offset={3} radius={14}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, borderRadius: 14, paddingLeft: 14, paddingRight: 6, minHeight: 52 }}>
          <Text style={{ flex: 1, fontFamily: font.heavy, fontSize: 14, color: ink.brown }}>{message}</Text>
          {onUndo ? (
            <Pressable onPress={undo} accessibilityRole="button" hitSlop={6} style={{ minHeight: 44, minWidth: 60, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.black, fontSize: 14, color: ink.pool, textDecorationLine: 'underline' }}>Undo</Text>
            </Pressable>
          ) : null}
        </View>
      </Raised>
    </Animated.View>
  );
}
