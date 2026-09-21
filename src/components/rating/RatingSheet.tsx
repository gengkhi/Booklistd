import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nextRating, REACTIONS, reactionFor } from '@/features/rating/reactions';
import { Dewey } from '@/components/dewey/Dewey';
import { ReactionDewey } from '@/components/dewey/ReactionDewey';
import { font, ink, radius } from '@/theme/palette';

const AUTO_CLOSE_MS = 1200;

/** "How was it?" — seven Dewey reactions. Saves on tap; closes itself shortly after the last tap. */
export function RatingSheet({
  visible, rating, onRate, onClose,
}: { visible: boolean; rating: number | null; onRate: (next: number | null) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<number | null>(rating);
  const [playKey, setPlayKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenReaderRef = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    if (visible) {
      setCurrent(rating);
      setPlayKey(0);
    } else {
      // Reset before the next open: Modal unmounts ReactionDewey on close, and its mount
      // effect fires whenever playKey !== 0. Resetting here (not on open) guarantees playKey
      // is already 0 before Modal remounts it, since this effect always runs before the next
      // visible=true render can occur.
      setPlayKey(0);
    }
    return clear;
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (mounted) screenReaderRef.current = enabled;
    });
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
      screenReaderRef.current = enabled;
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const tap = (n: number) => {
    const next = nextRating(current, n);
    setCurrent(next);
    onRate(next);
    if (next !== null) setPlayKey((k) => k + 1);
    AccessibilityInfo.announceForAccessibility(next === null ? 'Rating cleared' : (reactionFor(next)?.label ?? 'Rating cleared'));
    clear();
    if (!screenReaderRef.current) {
      timer.current = setTimeout(onClose, AUTO_CLOSE_MS);
    }
  };

  const label = reactionFor(current)?.label ?? 'Tap how it felt';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close rating" />
      <View
        accessibilityViewIsModal
        style={{
          backgroundColor: ink.paper, borderTopWidth: 2.5, borderColor: ink.brown,
          borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
          paddingHorizontal: 16, paddingTop: 18, paddingBottom: insets.bottom + 12,
        }}
      >
        <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 30, color: ink.brown, textAlign: 'center' }}>How was it?</Text>
        <View style={{ alignItems: 'center' }}>
          <ReactionDewey rating={current} playKey={playKey} size={96} />
          <Text accessibilityLiveRegion="polite" style={{ fontFamily: font.black, fontSize: 16, color: ink.brown, marginTop: 4 }}>{label}</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 14 }}>
          {REACTIONS.map((r) => {
            const on = r.rating === current;
            return (
              <Pressable
                key={r.rating}
                onPress={() => tap(r.rating)}
                accessibilityRole="button"
                accessibilityLabel={`Rate: ${r.label}`}
                accessibilityState={{ selected: on }}
                style={{
                  width: 84, minHeight: 88, alignItems: 'center', paddingVertical: 6, borderRadius: 12, borderWidth: 2,
                  borderColor: on ? ink.brown : 'transparent', backgroundColor: on ? ink.bus : 'transparent',
                }}
              >
                <Dewey mood={r.mood} size={40} still />
                <Text style={{ fontFamily: font.heavy, fontSize: 11, lineHeight: 13, color: ink.brown, textAlign: 'center', marginTop: 2 }}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: ink.brown, textDecorationLine: 'underline' }}>Not now</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
