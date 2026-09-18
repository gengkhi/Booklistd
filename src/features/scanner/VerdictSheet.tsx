import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { ScanResult } from './useScanPipeline';
import { ownedLine, newFindLine } from '@/features/dewey/lines';
import { hashString } from '@/features/shelves/spineStyle';
import { CoverArt } from '@/components/shelf/CoverArt';
import { Dewey } from '@/components/dewey/Dewey';
import { Bubble } from '@/components/ui/Bubble';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { LeaderRow } from '@/components/ui/PocketCard';
import { Raised } from '@/components/ui/Raised';
import { Stamp } from '@/components/ui/Stamp';
import { Sticker } from '@/components/ui/Sticker';
import { font, ink, radius } from '@/theme/palette';
import { easeOut, motion } from '@/theme/motion';

// Timeline (ms after the sheet starts rising)
const T_MARK = 500; // stamp / sticker
const T_DEWEY = 800;
const T_SAY = 1150;

export function VerdictSheet({
  result, rooms, quiet, wishlisted = false, onKeepScanning, onAdd,
}: {
  result: ScanResult; rooms: string[]; quiet: boolean; wishlisted?: boolean;
  onKeepScanning: () => void; onAdd: (status: 'owned' | 'wishlist', room: string | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { verdict: v, meta, metaLoading, isbn13 } = result;
  const owned = v.owned;
  // Catalog lookup failed for an unknown book: an error state, so Dewey stays out of it (spec §5).
  const lookupFailed = !owned && !metaLoading && !meta && !v.book;
  const title = v.book?.title ?? meta?.title ?? `ISBN ${isbn13}`;
  const author = (v.book?.authors ?? meta?.authors ?? [])[0];
  const edition = [v.book?.publisher ?? meta?.publisher, v.book?.publishedYear ?? meta?.publishedYear].filter(Boolean).join(', ');
  const [room, setRoom] = useState<string | null>(rooms[0] ?? null);
  const [say, setSay] = useState(false);

  const rise = useSharedValue(700);
  const shake = useSharedValue(0);
  useEffect(() => {
    rise.value = withTiming(0, { duration: motion.overlay, easing: easeOut });
    const t = setTimeout(() => setSay(true), T_SAY);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value }] }));
  const card = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const onStampLand = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (!reduced) shake.value = withSequence(withTiming(-3, { duration: 60 }), withTiming(3, { duration: 60 }), withTiming(0, { duration: 80 }));
  };

  const perRoom = useMemo(() => {
    const m = new Map<string, number>();
    v.userBooks.forEach((ub) => m.set(ub.location?.trim() || 'Unshelved', (m.get(ub.location?.trim() || 'Unshelved') ?? 0) + 1));
    return [...m.entries()];
  }, [v.userBooks]);

  const fg = owned ? ink.white : ink.brown;
  const line = owned ? ownedLine(v.copies, v.exactIsbnMatch) : newFindLine(hashString(isbn13));

  return (
    <Animated.View
      accessibilityViewIsModal
      style={[
        {
          position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 10,
          backgroundColor: owned ? ink.grass : ink.paper, borderTopWidth: 2.5, borderColor: ink.brown,
          borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
          paddingHorizontal: 20, paddingTop: 22, paddingBottom: insets.bottom + 20,
        },
        sheet,
      ]}
    >
      {!lookupFailed ? (
        <View style={{ position: 'absolute', right: 16, top: -56, zIndex: 11 }}>
          <Dewey mood={owned ? 'smug' : 'gasp'} size={70} pop popDelay={T_DEWEY} />
        </View>
      ) : null}
      {say && !quiet && !lookupFailed ? <Bubble text={line} width={176} style={{ position: 'absolute', right: 90, top: -66, zIndex: 11 }} /> : null}

      <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 40, lineHeight: 44, color: fg }}>
        {owned ? 'You own this!' : 'A new find!'}
      </Text>

      <Animated.View style={[{ marginTop: 14 }, card]}>
        <Raised offset={3} radius={14}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: ink.white, borderWidth: 2.5, borderColor: ink.brown, borderRadius: 14, padding: 12 }}>
            <CoverArt id={v.book?.id ?? isbn13} title={title} coverUrl={v.book?.coverUrl ?? meta?.coverUrl} width={62} height={92} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={{ fontFamily: font.black, fontSize: 17, color: ink.brown }}>{title}</Text>
              {author || edition ? <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft, marginTop: 2 }}>{[author, edition].filter(Boolean).join(' · ')}</Text> : null}
              {owned ? (
                <View style={{ marginTop: 4 }}>
                  <LeaderRow label="Copies" value={String(v.copies)} />
                  {perRoom.slice(0, 2).map(([name, n]) => <LeaderRow key={name} label={name} value={String(n)} />)}
                </View>
              ) : metaLoading ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <ActivityIndicator color={ink.brown} />
                  <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft }}>Dewey is looking it up…</Text>
                </View>
              ) : wishlisted ? (
                <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.plum, marginTop: 4 }}>On your wishlist</Text>
              ) : lookupFailed ? (
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft, marginTop: 4 }}>Couldn't reach the catalog. You can still add it by ISBN.</Text>
              ) : (
                <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.grass, marginTop: 4 }}>Not on any shelf · not on your wishlist</Text>
              )}
            </View>
          </View>
        </Raised>
        {owned ? (
          <Stamp label="ALREADY YOURS" play delay={T_MARK} onLand={onStampLand} style={{ position: 'absolute', right: 10, top: -18 }} />
        ) : (
          <Sticker label="NEW!" play delay={T_MARK} style={{ position: 'absolute', right: -8, top: -18 }} />
        )}
      </Animated.View>

      {owned ? (
        <>
          <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: fg, marginTop: 12 }}>
            {v.exactIsbnMatch ? 'Same edition you scanned. Put it back gently.' : `Different edition. You own ${v.copies} of this title.`}
          </Text>
          <View style={{ marginTop: 16 }}>
            <Button label="Keep scanning" onPress={onKeepScanning} />
          </View>
          <Pressable onPress={() => onAdd('owned', v.userBooks[0]?.location ?? null)} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: fg, textDecorationLine: 'underline' }}>{`Add copy #${v.copies + 1} anyway`}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.brown, marginTop: 14 }}>Shelve it in</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {rooms.map((r) => <Chip key={r} label={r} selected={room === r} onPress={() => setRoom(r)} />)}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            {!wishlisted ? <Button variant="ghost" flex label="Wishlist it" onPress={() => onAdd('wishlist', null)} disabled={metaLoading} /> : null}
            <Button flex label="Add to shelves" onPress={() => onAdd('owned', room)} disabled={metaLoading} />
          </View>
          <Pressable onPress={onKeepScanning} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: ink.brown, textDecorationLine: 'underline' }}>Not now, keep scanning</Text>
          </Pressable>
        </>
      )}
    </Animated.View>
  );
}
