import React, { useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { FadeInUp } from 'react-native-reanimated';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  addUserBook, getBookDetail, listShelves, setCopyShelf, setReadingDates, setReadingRating, setReadingState, setStatus,
} from '@/db/repository';
import type { ReadingState } from '@/lib/types';
import { cardRows, type CardRowKey } from '@/features/bookDetail/cardRows';
import { needsDetails } from '@/features/bookEdits/editLogic';
import { primaryAction, primaryLabel } from '@/features/reading/detailActions';
import { isoToDate, READING_LABEL, READING_STATES, todayIso } from '@/features/reading/readingLogic';
import { reactionFor, shouldPromptRating } from '@/features/rating/reactions';
import { UNSHELVED } from '@/features/shelves/shelfRules';
import { useRemoveCopy } from '@/features/shelves/useRemoveCopy';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { useSettings } from '@/stores/settings';
import { ShelfPicker } from '@/components/shelves/ShelfPicker';
import { CoverArt } from '@/components/shelf/CoverArt';
import { Dewey } from '@/components/dewey/Dewey';
import { RatingSheet } from '@/components/rating/RatingSheet';
import { Button } from '@/components/ui/Button';
import { CardSheet } from '@/components/ui/CardSheet';
import { Chip } from '@/components/ui/Chip';
import { PocketCard } from '@/components/ui/PocketCard';
import { Raised } from '@/components/ui/Raised';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

type Sheet = null | 'shelf' | 'status' | 'copies' | 'started' | 'finished';

const ROW_HINT: Partial<Record<CardRowKey, string>> = {
  loan: 'Double-tap to nudge',
  edition: 'Double-tap to edit details',
  rating: 'Double-tap to rate',
};

function CardRowView({ label, value, tappable, hint, onPress, face }: {
  label: string; value: string; tappable: boolean; hint?: string; onPress?: () => void; face?: React.ReactNode;
}) {
  return (
    <Pressable disabled={!tappable} onPress={onPress} accessibilityRole={tappable ? 'button' : undefined}
      accessibilityLabel={`${label}: ${value}`} accessibilityHint={tappable ? hint : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
      <Text style={{ fontFamily: font.bold, fontSize: 14, color: ink.brown }}>{label}</Text>
      <Text numberOfLines={1} ellipsizeMode="clip" style={{ flex: 1, marginHorizontal: 6, color: ink.soft, fontFamily: font.black, fontSize: 12 }}>
        {' · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·'}
      </Text>
      {face}
      <Text numberOfLines={1} style={{ fontFamily: font.black, fontSize: 14, color: ink.brown, maxWidth: '55%' }}>{value}</Text>
      {tappable ? <Text style={{ fontFamily: font.black, fontSize: 14, color: ink.soft, marginLeft: 4 }}>›</Text> : null}
    </Pressable>
  );
}

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const quiet = useSettings((s) => s.quiet);
  const removeCopy = useRemoveCopy();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [rateOpen, setRatingOpen] = useState(false);
  const [movingCopy, setMovingCopy] = useState<string | null>(null);
  const pendingRating = useRef(false);
  const { data: detail } = useQuery({ queryKey: ['book', id], queryFn: () => getBookDetail(id) });
  const { data: shelves = [] } = useQuery({ queryKey: ['shelves'], queryFn: () => listShelves() });
  if (!detail) return <View style={{ flex: 1, backgroundColor: c.paper }} />;

  const { book, copies, wishlistCopy, reading, focusCopyId } = detail;
  const today = todayIso();
  const focus = copies.find((cp) => cp.id === focusCopyId) ?? null;
  const refresh = () => invalidateLibrary(qc);
  const rows = cardRows({
    copies: copies.map((cp) => ({ shelfName: cp.shelfName, borrower: cp.borrower, loanedAt: cp.loanedAt })),
    focusShelfName: focus?.shelfName ?? null,
    wishlist: !!wishlistCopy,
    reading,
    book: { publisher: book.publisher, publishedYear: book.publishedYear, isbn13: book.isbn13 },
  }, today, new Date());
  const lent = copies.find((cp) => cp.borrower);

  const changeState = (s: ReadingState) => {
    const prev = reading?.state ?? null;
    if (prev === s) {
      const clear = () => { setReadingState(book.id, null); refresh(); };
      if (reading?.rating) {
        Alert.alert('Clear your reading?', 'This removes your rating too.', [
          { text: 'Keep it', style: 'cancel' },
          { text: 'Clear', style: 'destructive', onPress: clear },
        ]);
      } else clear();
      return;
    }
    setReadingState(book.id, s, today);
    refresh();
    const sheetOpen = sheet !== null;
    setSheet(null);
    if (shouldPromptRating(prev, s)) {
      if (sheetOpen && Platform.OS === 'android') {
        setTimeout(() => setRatingOpen(true), 350);
      } else if (sheetOpen) {
        pendingRating.current = true;
      } else {
        setRatingOpen(true);
      }
    }
  };

  const nudge = () => {
    if (!lent?.borrower) return;
    Share.share({ message: `Hi ${lent.borrower}! How is ${book.title} treating you?${quiet ? '' : ' No rush. (Some rush.)'}` });
  };

  const tap = (key: CardRowKey) => {
    switch (key) {
      case 'shelf': return setSheet('shelf');
      case 'status': return setSheet('status');
      case 'rating': return setRatingOpen(true);
      // An empty date saves today in one tap; the picker still opens to adjust it.
      case 'started':
        if (!reading?.startedAt) { setReadingDates(book.id, { startedAt: today }); refresh(); }
        return setSheet('started');
      case 'finished':
        if (!reading?.finishedAt) { setReadingDates(book.id, { finishedAt: today }); refresh(); }
        return setSheet('finished');
      case 'copies': return setSheet('copies');
      case 'loan': return nudge();
      case 'edition': return router.push({ pathname: '/book/edit', params: { bookId: book.id } });
      case 'isbn': return undefined;
    }
  };

  const removeOne = (copyId: string, leave: boolean) =>
    removeCopy(copyId, { onRemoved: () => { setSheet(null); setMovingCopy(null); if (leave) { if (router.canGoBack()) router.back(); else router.replace('/'); } } });

  const openMenu = () => {
    const items: { label: string; run: () => void; destructive?: boolean }[] = [
      { label: 'Edit details', run: () => router.push({ pathname: '/book/edit', params: { bookId: book.id } }) },
    ];
    if (copies.length === 1) items.push({ label: 'Move to shelf…', run: () => setSheet('shelf') });
    if (copies.length === 1) items.push({ label: 'Remove from shelves', destructive: true, run: () => removeOne(copies[0].id, true) });
    if (copies.length > 1) items.push({ label: 'Remove from shelves', destructive: true, run: () => setSheet('copies') });
    if (Platform.OS === 'ios') {
      const options = [...items.map((i) => i.label), 'Cancel'];
      const destructiveButtonIndex = items.findIndex((i) => i.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: destructiveButtonIndex >= 0 ? destructiveButtonIndex : undefined },
        (i) => items[i]?.run()
      );
    } else {
      Alert.alert(book.title, undefined, [...items.map((i) => ({ text: i.label, onPress: i.run, style: i.destructive ? 'destructive' as const : 'default' as const })), { text: 'Cancel', style: 'cancel' as const }]);
    }
  };

  const action = primaryAction({
    ownedCopies: copies.length, wishlistCopy: !!wishlistCopy, loanedTo: lent?.borrower ?? null, readingState: reading?.state ?? null,
  });
  const runPrimary = () => {
    if (!action) return;
    switch (action.kind) {
      case 'found': setStatus(wishlistCopy!.id, 'owned'); refresh(); return;
      case 'nudge': nudge(); return;
      case 'start': changeState('reading'); return;
      case 'finish':
      case 'markRead': changeState('read'); return;
    }
  };

  const face = reading?.rating ? reactionFor(reading.rating) : null;
  const dateSheet = sheet === 'started' || sheet === 'finished';
  const dateValue = sheet === 'finished' ? reading?.finishedAt : reading?.startedAt;
  const datePickerProps = dateSheet ? {
    value: dateValue ? isoToDate(dateValue) : isoToDate(today),
    mode: 'date' as const,
    maximumDate: isoToDate(today),
    minimumDate: sheet === 'finished' && reading?.startedAt ? isoToDate(reading.startedAt) : undefined,
    accessibilityLabel: `${sheet === 'finished' ? 'Finished' : 'Started'} date`,
    onChange: (e: DateTimePickerEvent, d?: Date) => {
      if (Platform.OS !== 'ios') setSheet(null);
      if (e.type === 'set' && d) {
        setReadingDates(book.id, sheet === 'finished' ? { finishedAt: todayIso(d) } : { startedAt: todayIso(d) });
        refresh();
      }
    },
  } : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: action ? 120 : 40 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4 }}>
          <Raised offset={2} radius={22}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={20} height={20} fill="none" stroke={ink.brown} strokeWidth={2.8}><Path d="M13 4l-7 6 7 6" /></Svg>
            </Pressable>
          </Raised>
          <Raised offset={2} radius={22}>
            <Pressable onPress={openMenu} accessibilityRole="button" accessibilityLabel="More actions"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={20} height={20} fill={ink.brown}><Circle cx={4} cy={10} r={2} /><Circle cx={10} cy={10} r={2} /><Circle cx={16} cy={10} r={2} /></Svg>
            </Pressable>
          </Raised>
        </View>

        <View style={{ flexDirection: 'row', gap: 18, paddingHorizontal: 20, paddingTop: 14, alignItems: 'flex-end' }}>
          <Animated.View entering={FadeInUp.duration(600).withInitialValues({ transform: [{ translateY: -120 }] })}>
            <View style={{ transform: [{ rotate: '-4deg' }] }}>
              <Raised offset={5} radius={6}>
                <CoverArt id={focus?.id ?? book.id} title={book.title} author={book.authors[0]} coverUrl={book.coverUrl} width={120} height={178} />
              </Raised>
            </View>
          </Animated.View>
          <View style={{ flex: 1, paddingBottom: 6 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 32, lineHeight: 36, color: c.text }}>{book.title}</Text>
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.soft, marginTop: 4 }}>{book.authors.join(', ')}</Text>
          </View>
        </View>

        <PocketCard title="Library card" style={{ marginHorizontal: 16, marginTop: 22 }}>
          {book.edited ? (
            <View style={{ position: 'absolute', right: 0, top: -2, borderWidth: 2, borderColor: ink.plum, borderRadius: 3, paddingHorizontal: 6, transform: [{ rotate: '-4deg' }] }}>
              <Text style={{ fontFamily: font.black, fontSize: 10, color: ink.plum }}>Edited by you</Text>
            </View>
          ) : null}
          {rows.map((r) => (
            <CardRowView key={r.key} label={r.label} value={r.value} tappable={r.tappable}
              hint={ROW_HINT[r.key] ?? 'Double-tap to change'} onPress={() => tap(r.key)}
              face={r.key === 'rating' && face ? <View style={{ marginRight: 4 }}><Dewey mood={face.mood} size={22} still /></View> : undefined} />
          ))}
        </PocketCard>

        {needsDetails(book) ? (
          <Pressable
            onPress={() => router.push({ pathname: '/book/edit', params: { bookId: book.id } })}
            accessibilityRole="button"
            style={{ marginHorizontal: 16, marginTop: 14, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: ink.tape, borderWidth: 2, borderColor: c.line, borderRadius: 10, padding: 10 }}
          >
            <Dewey size={38} mood="gasp" />
            <Text style={{ flex: 1, fontFamily: font.heavy, fontSize: 13, color: ink.brown }}>Missing details. Add them so you can find it later.</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {action ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 12, backgroundColor: c.paper, borderTopWidth: 2, borderColor: c.line }}>
          <Button label={primaryLabel(action)} onPress={runPrimary} />
        </View>
      ) : null}

      <CardSheet visible={sheet === 'shelf'} title={copies.length ? 'Move to shelf' : 'Add this book'} onClose={() => setSheet(null)}>
        {copies.length && focus ? (
          <ShelfPicker shelves={shelves} selected={focus.shelfId}
            onSelect={(sid) => { setCopyShelf(focus.id, sid); refresh(); setSheet(null); }} onCreated={refresh} />
        ) : wishlistCopy ? (
          <View style={{ marginTop: 12 }}><Button label="Found it!" onPress={() => { setStatus(wishlistCopy.id, 'owned'); refresh(); setSheet(null); }} /></View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Button variant="ghost" flex label="Wishlist it" onPress={() => { addUserBook(book.id, 'wishlist'); refresh(); setSheet(null); }} />
            <Button flex label="Add to shelves" onPress={() => { addUserBook(book.id, 'owned'); refresh(); setSheet(null); }} />
          </View>
        )}
      </CardSheet>

      <CardSheet visible={sheet === 'status'} title="Where are you with it?" onClose={() => setSheet(null)}
        onDismiss={() => { if (pendingRating.current) { pendingRating.current = false; setRatingOpen(true); } }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {READING_STATES.map((s) => <Chip key={s} label={READING_LABEL[s]} selected={reading?.state === s} onPress={() => changeState(s)} />)}
        </View>
      </CardSheet>

      <CardSheet visible={sheet === 'copies'} title="Your copies" onClose={() => { setSheet(null); setMovingCopy(null); }}>
        {copies.map((cp, i) => (
          <View key={cp.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, borderBottomWidth: 1.5, borderColor: ink.cream }}>
              <Text style={{ flex: 1, fontFamily: font.heavy, fontSize: 14, color: ink.brown }}>
                {`Copy ${i + 1} · ${cp.shelfName ?? UNSHELVED}${cp.borrower ? ` · visiting ${cp.borrower}` : ''}`}
              </Text>
              <Pressable onPress={() => setMovingCopy((m) => (m === cp.id ? null : cp.id))} accessibilityRole="button" accessibilityLabel={`Move copy ${i + 1}`}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
                <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.brown, textDecorationLine: 'underline' }}>Move</Text>
              </Pressable>
              <Pressable onPress={() => removeOne(cp.id, copies.length === 1)} accessibilityRole="button" accessibilityLabel={`Remove copy ${i + 1}`}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
                <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.tomato, textDecorationLine: 'underline' }}>Remove</Text>
              </Pressable>
            </View>
            {movingCopy === cp.id ? (
              <ShelfPicker shelves={shelves} selected={cp.shelfId}
                onSelect={(sid) => { setCopyShelf(cp.id, sid); refresh(); setMovingCopy(null); }} onCreated={refresh} />
            ) : null}
          </View>
        ))}
      </CardSheet>

      <CardSheet visible={dateSheet && Platform.OS === 'ios'} title={sheet === 'finished' ? 'Finished' : 'Started'} onClose={() => setSheet(null)}>
        {dateSheet && datePickerProps ? <DateTimePicker {...datePickerProps} display="inline" /> : null}
      </CardSheet>

      {dateSheet && datePickerProps && Platform.OS !== 'ios' ? <DateTimePicker {...datePickerProps} display="default" /> : null}

      <RatingSheet
        visible={rateOpen}
        rating={reading?.rating ?? null}
        onRate={(n) => { setReadingRating(book.id, n); refresh(); }}
        onClose={() => setRatingOpen(false)}
      />
    </SafeAreaView>
  );
}
