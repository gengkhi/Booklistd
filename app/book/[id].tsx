import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeInUp } from 'react-native-reanimated';
import {
  addUserBook, getBookDetail, listLibrary, listShelves, setCopyShelf, setReadingDates, setReadingRating, setReadingState, setStatus,
} from '@/db/repository';
import type { ReadingState } from '@/lib/types';
import { UNSHELVED } from '@/features/shelves/shelfRules';
import { needsDetails } from '@/features/bookEdits/editLogic';
import { primaryAction, primaryLabel } from '@/features/reading/detailActions';
import { READING_LABEL, todayIso } from '@/features/reading/readingLogic';
import { shouldPromptRating } from '@/features/rating/reactions';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { useSettings } from '@/stores/settings';
import { ShelfPicker } from '@/components/shelves/ShelfPicker';
import { CoverArt } from '@/components/shelf/CoverArt';
import { Spine } from '@/components/shelf/Spine';
import { Dewey } from '@/components/dewey/Dewey';
import { RatingSheet } from '@/components/rating/RatingSheet';
import { ReadingControls } from '@/components/reading/ReadingControls';
import { Button } from '@/components/ui/Button';
import { LeaderRow, PocketCard } from '@/components/ui/PocketCard';
import { Raised } from '@/components/ui/Raised';
import { TapeNote } from '@/components/ui/TapeNote';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const daysSince = (iso: string) => Math.max(1, Math.round((Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 86400000));

/** Non-interactive status badge — same look as Chip but never a fake button. */
function Pill({ label, selected }: { label: string; selected?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        height: 32, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 2, borderColor: c.line,
        backgroundColor: selected ? ink.brown : ink.white, alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: font.heavy, fontSize: 12.5, color: selected ? ink.white : ink.brown }}>{label}</Text>
    </View>
  );
}

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const quiet = useSettings((s) => s.quiet);
  const [moving, setMoving] = useState(false);
  const [rateOpen, setRatingOpen] = useState(false);
  const { data: detail } = useQuery({ queryKey: ['book', id], queryFn: () => getBookDetail(id) });
  const { data: all = [] } = useQuery({ queryKey: ['library'], queryFn: () => listLibrary() });
  const { data: shelves = [] } = useQuery({ queryKey: ['shelves'], queryFn: () => listShelves() });
  if (!detail) return <View style={{ flex: 1, backgroundColor: c.paper }} />;

  const { book, copies, wishlistCopy, reading, focusCopyId } = detail;
  const today = todayIso();
  const focus = copies.find((cp) => cp.id === focusCopyId) ?? null;
  const room = focus?.shelfName ?? UNSHELVED;
  const neighbours = focus ? all.filter((r) => r.status !== 'wishlist' && (r.shelfId ?? null) === (focus.shelfId ?? null)) : [];
  const at = focus ? neighbours.findIndex((r) => r.id === focus.id) : -1;
  const left = at === -1 ? [] : neighbours.slice(Math.max(0, at - 3), at);
  const right = at === -1 ? [] : neighbours.slice(at + 1, at + 4);
  const loaned = copies.find((cp) => cp.borrower);
  const loanDays = loaned?.loanedAt ? daysSince(loaned.loanedAt) : 0;
  const refresh = () => invalidateLibrary(qc);

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
    if (shouldPromptRating(prev, s)) setRatingOpen(true);
  };

  const action = primaryAction({
    ownedCopies: copies.length, wishlistCopy: !!wishlistCopy, loanedTo: loaned?.borrower ?? null, readingState: reading?.state ?? null,
  });
  const runPrimary = () => {
    if (!action) return;
    switch (action.kind) {
      case 'found': setStatus(wishlistCopy!.id, 'owned'); refresh(); return;
      case 'nudge':
        Share.share({ message: `Hi ${action.borrower}! How is ${book.title} treating you?${quiet ? '' : ' No rush. (Some rush.)'}` });
        return;
      case 'start': changeState('reading'); return;
      case 'finish':
      case 'markRead': changeState('read'); return;
    }
  };

  const ownershipLabel = copies.length ? `At home · ${room}` : wishlistCopy ? 'On your wishlist' : 'Not on your shelves';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4 }}>
          <Raised offset={2} radius={22}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={20} height={20} fill="none" stroke={ink.brown} strokeWidth={2.8}><Path d="M13 4l-7 6 7 6" /></Svg>
            </Pressable>
          </Raised>
        </View>

        {focus ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <TapeNote text={`${room} — its spot`} style={{ alignSelf: 'flex-start', marginBottom: 4 }} />
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height: 74 }}>
              {left.map((r) => <Spine key={r.id} id={r.id} title="" scale={0.55} />)}
              <View style={{ width: 32, height: 62, borderWidth: 2, borderStyle: 'dashed', borderColor: c.line, borderRadius: radius.spine, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 3 }}>
                <Text style={{ fontFamily: font.black, fontSize: 8, color: c.text }}>HERE</Text>
              </View>
              {right.map((r) => <Spine key={r.id} id={r.id} title="" scale={0.55} />)}
            </View>
            <View style={{ height: 12, backgroundColor: ink.tomato, borderWidth: 2, borderColor: c.line }} />
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 18, paddingHorizontal: 20, paddingTop: 22, alignItems: 'flex-end' }}>
          <Animated.View entering={FadeInUp.duration(600).withInitialValues({ transform: [{ translateY: -120 }] })}>
            <View style={{ transform: [{ rotate: '-4deg' }] }}>
              <Raised offset={5} radius={6}>
                <CoverArt id={focus?.id ?? book.id} title={book.title} author={book.authors[0]} coverUrl={book.coverUrl} width={132} height={196} />
              </Raised>
            </View>
          </Animated.View>
          <View style={{ flex: 1, paddingBottom: 6 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 34, lineHeight: 38, color: c.text }}>{book.title}</Text>
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.soft, marginTop: 4 }}>{book.authors.join(', ')}</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              <Pill label={ownershipLabel} selected />
              {reading ? <Pill label={READING_LABEL[reading.state]} /> : null}
              {book.edited ? <Pill label="Edited by you" /> : null}
            </View>
          </View>
        </View>

        <ReadingControls
          reading={reading}
          today={today}
          onState={changeState}
          onDates={(d) => { setReadingDates(book.id, d); refresh(); }}
          onRate={() => setRatingOpen(true)}
        />

        {copies.length === 0 && !wishlistCopy ? (
          <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 18 }}>
            <Button variant="ghost" flex label="Wishlist it" onPress={() => { addUserBook(book.id, 'wishlist'); refresh(); }} />
            <Button flex label="Add to shelves" onPress={() => { addUserBook(book.id, 'owned'); refresh(); }} />
          </View>
        ) : null}

        <PocketCard title={copies.length ? `Pocket card · ${copies.length} ${copies.length === 1 ? 'copy' : 'copies'}` : 'Pocket card'} style={{ marginHorizontal: 16, marginTop: 22 }}>
          {copies.map((cp, i) => (
            <LeaderRow key={cp.id} label={`Copy ${i + 1}`} value={cp.borrower ? `Visiting ${cp.borrower}` : cp.shelfName ?? UNSHELVED} />
          ))}
          {book.publisher || book.publishedYear ? <LeaderRow label="Edition" value={[book.publisher, book.publishedYear].filter(Boolean).join(', ')} /> : null}
          <LeaderRow label="ISBN" value={book.isbn13 ?? '—'} />
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

        <Pressable
          onPress={() => router.push({ pathname: '/book/edit', params: { bookId: book.id } })}
          accessibilityRole="button"
          style={{ marginHorizontal: 16, marginTop: 10, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: c.text, textDecorationLine: 'underline' }}>Edit details</Text>
        </Pressable>

        {loaned?.loanedAt ? (
          <View style={{ marginHorizontal: 16, marginTop: 14, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: ink.tape, borderWidth: 2, borderColor: c.line, borderRadius: 10, padding: 10 }}>
            <Dewey size={38} />
            <Text style={{ flex: 1, fontFamily: font.heavy, fontSize: 13, color: ink.brown }}>
              {`A copy has been visiting ${loaned.borrower} for ${loanDays} ${loanDays === 1 ? 'day' : 'days'}.`}
            </Text>
          </View>
        ) : null}

        {moving && focus ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <ShelfPicker
              shelves={shelves}
              selected={focus.shelfId}
              onSelect={(id) => { setCopyShelf(focus.id, id); setMoving(false); refresh(); }}
              onCreated={refresh}
            />
          </View>
        ) : null}

        {focus || action ? (
          <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 16 }}>
            {focus ? <Button variant="ghost" flex label={moving ? 'Cancel' : 'Move shelf'} onPress={() => setMoving((m) => !m)} /> : null}
            {action ? <Button flex label={primaryLabel(action)} onPress={runPrimary} /> : null}
          </View>
        ) : null}
      </ScrollView>
      <RatingSheet
        visible={rateOpen}
        rating={reading?.rating ?? null}
        onRate={(n) => { setReadingRating(book.id, n); refresh(); }}
        onClose={() => setRatingOpen(false)}
      />
    </SafeAreaView>
  );
}
