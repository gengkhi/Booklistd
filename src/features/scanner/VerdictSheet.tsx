import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { ScanResult } from './useScanPipeline';
import { rateLimitedMessage } from '@/api/lookupErrors';
import { newFindNote, readVerdictLine, storeVerdict } from './storeVerdict';
import { ownedLine, newFindLine } from '@/features/dewey/lines';
import { reactionFor } from '@/features/rating/reactions';
import { readingLine, todayIso } from '@/features/reading/readingLogic';
import { hashString } from '@/features/shelves/spineStyle';
import type { ShelfRow } from '@/lib/types';
import { ShelfPicker } from '@/components/shelves/ShelfPicker';
import { CoverArt } from '@/components/shelf/CoverArt';
import { Dewey, type DeweyMood } from '@/components/dewey/Dewey';
import { Bubble } from '@/components/ui/Bubble';
import { Button } from '@/components/ui/Button';
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

function LinkButton({ label, onPress, color }: { label: string; onPress: () => void; color: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
      <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color, textDecorationLine: 'underline' }}>{label}</Text>
    </Pressable>
  );
}

export function VerdictSheet({
  result, shelves, quiet, onKeepScanning, onAdd, onAddDetails, onWantToRead, onShelvesChanged,
}: {
  result: ScanResult; shelves: ShelfRow[]; quiet: boolean;
  onKeepScanning: () => void; onAdd: (status: 'owned' | 'wishlist', shelfId: string | null) => void;
  onAddDetails: (shelfId: string | null) => void; onWantToRead: () => void; onShelvesChanged: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { verdict: v, meta, metaLoading, isbn13, rateLimitedFor } = result;
  const kind = storeVerdict({ ownedCopies: v.owned ? v.copies : 0, wishlistCopies: v.wishlistCopies.length, reading: v.reading });
  const owned = kind === 'owned';
  const wishlisted = v.wishlistCopies.length > 0;
  // Catalog lookup failed for an unknown book: an error state, so Dewey stays out of it.
  const lookupFailed = kind === 'new' && !metaLoading && !meta && !v.book;
  const title = v.book?.title ?? meta?.title ?? `ISBN ${isbn13}`;
  const author = (v.book?.authors ?? meta?.authors ?? [])[0];
  const edition = [v.book?.publisher ?? meta?.publisher, v.book?.publishedYear ?? meta?.publishedYear].filter(Boolean).join(', ');
  const today = todayIso();
  const [room, setRoom] = useState<string | null>(shelves[0]?.id ?? null);
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
    v.userBooks.forEach((ub) => m.set(ub.shelfName ?? 'Unshelved', (m.get(ub.shelfName ?? 'Unshelved') ?? 0) + 1));
    return [...m.entries()];
  }, [v.userBooks]);

  const fg = owned ? ink.white : ink.brown;
  const heading =
    kind === 'owned' ? 'You own this!'
      : kind === 'wishlist' ? 'Found one!'
        : kind === 'read' ? "You've read this"
          : lookupFailed ? (rateLimitedFor != null ? "Catalog's busy." : "We couldn't find this one.") : 'A new find!';
  const mood: DeweyMood =
    kind === 'owned' ? 'smug' : kind === 'wishlist' ? 'happy' : kind === 'read' ? reactionFor(v.reading?.rating)?.mood ?? 'happy' : 'gasp';
  const line =
    kind === 'owned' ? ownedLine(v.copies, v.exactIsbnMatch)
      : kind === 'wishlist' ? "That's the one you wanted."
        : kind === 'read' ? "We've met this one before."
          : newFindLine(hashString(isbn13));
  const status = readingLine(v.reading, today);

  const roomPicker = (
    <>
      <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.brown, marginTop: 14 }}>Shelve it in</Text>
      <ShelfPicker shelves={shelves} selected={room} onSelect={setRoom} onCreated={onShelvesChanged} />
    </>
  );

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
          <Dewey mood={mood} size={70} pop popDelay={T_DEWEY} />
        </View>
      ) : null}
      {say && !quiet && !lookupFailed ? <Bubble text={line} width={176} style={{ position: 'absolute', right: 90, top: -66, zIndex: 11 }} /> : null}

      <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 40, lineHeight: 44, color: fg }}>{heading}</Text>

      <Animated.View style={[{ marginTop: 14 }, card]}>
        <Raised offset={3} radius={14}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: ink.white, borderWidth: 2.5, borderColor: ink.brown, borderRadius: 14, padding: 12 }}>
            <CoverArt id={v.book?.id ?? isbn13} title={title} coverUrl={v.book?.coverPending ? null : (v.book?.coverUrl ?? meta?.coverUrl)} bookId={v.book?.id} coverPending={v.book?.coverPending} coverObject={v.book?.coverObject} width={62} height={92} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={{ fontFamily: font.black, fontSize: 17, color: ink.brown }}>{title}</Text>
              {author || edition ? <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft, marginTop: 2 }}>{[author, edition].filter(Boolean).join(' · ')}</Text> : null}
              {kind === 'owned' ? (
                <View style={{ marginTop: 4 }}>
                  <LeaderRow label="Copies" value={String(v.copies)} />
                  {perRoom.slice(0, 2).map(([name, n]) => <LeaderRow key={name} label={name} value={String(n)} />)}
                  {status ? <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.plum, marginTop: 4 }}>{status}</Text> : null}
                </View>
              ) : metaLoading ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <ActivityIndicator color={ink.brown} />
                  <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft }}>Dewey is looking it up…</Text>
                </View>
              ) : kind === 'wishlist' ? (
                <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.plum, marginTop: 4 }}>{status ? `On your wishlist · ${status}` : 'On your wishlist'}</Text>
              ) : kind === 'read' ? (
                <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.plum, marginTop: 4 }}>{readVerdictLine(v.reading!)}</Text>
              ) : lookupFailed ? (
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft, marginTop: 4 }}>
                  {rateLimitedFor != null ? rateLimitedMessage(rateLimitedFor) : "No catalog had it, or we couldn't reach one. You can add the details yourself."}
                </Text>
              ) : (
                <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.grass, marginTop: 4 }}>{newFindNote(v.reading) ?? 'Not on any shelf · not on your wishlist'}</Text>
              )}
            </View>
          </View>
        </Raised>
        {kind === 'owned' ? (
          <Stamp label="ALREADY YOURS" play delay={T_MARK} onLand={onStampLand} style={{ position: 'absolute', right: 10, top: -18 }} />
        ) : kind === 'wishlist' ? (
          <Sticker label="WISHLIST" size={78} play delay={T_MARK} style={{ position: 'absolute', right: -8, top: -18 }} />
        ) : kind === 'read' ? (
          <Sticker label="READ" play delay={T_MARK} style={{ position: 'absolute', right: -8, top: -18 }} />
        ) : (
          <Sticker label="NEW!" play delay={T_MARK} style={{ position: 'absolute', right: -8, top: -18 }} />
        )}
      </Animated.View>

      {kind === 'owned' ? (
        <>
          <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: fg, marginTop: 12 }}>
            {v.exactIsbnMatch ? 'Same edition you scanned. Put it back gently.' : `Different edition. You own ${v.copies} of this title.`}
          </Text>
          <View style={{ marginTop: 16 }}>
            <Button label="Keep scanning" onPress={onKeepScanning} />
          </View>
          <LinkButton label={`Add copy #${v.copies + 1} anyway`} onPress={() => onAdd('owned', v.userBooks[0]?.shelfId ?? null)} color={fg} />
        </>
      ) : kind === 'wishlist' ? (
        <>
          {roomPicker}
          <View style={{ marginTop: 16 }}>
            <Button label="Got it! Shelve it" onPress={() => onAdd('owned', room)} />
          </View>
          <LinkButton label="Keep scanning" onPress={onKeepScanning} color={ink.brown} />
        </>
      ) : (
        <>
          {roomPicker}
          {lookupFailed ? (
            <>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                {!wishlisted ? <Button variant="ghost" flex label="Wishlist it" onPress={() => onAdd('wishlist', null)} /> : null}
                <Button flex label="Add details" onPress={() => onAddDetails(room)} />
              </View>
              <LinkButton label="Add with just the ISBN" onPress={() => onAdd('owned', room)} color={ink.brown} />
            </>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              {!wishlisted ? <Button variant="ghost" flex label="Wishlist it" onPress={() => onAdd('wishlist', null)} disabled={metaLoading} /> : null}
              <Button flex label="Add to shelves" onPress={() => onAdd('owned', room)} disabled={metaLoading} />
            </View>
          )}
          {kind === 'new' && !v.reading && !metaLoading ? <LinkButton label="Want to read" onPress={onWantToRead} color={ink.brown} /> : null}
          <LinkButton label={kind === 'read' ? 'Keep scanning' : 'Not now, keep scanning'} onPress={onKeepScanning} color={ink.brown} />
        </>
      )}
    </Animated.View>
  );
}
