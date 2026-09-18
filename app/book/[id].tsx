import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { getLibraryRow, listCopiesOfBook, listLibrary, listRooms, setLocation, setStatus } from '@/db/repository';
import { UNSHELVED } from '@/features/shelves/groupByRoom';
import { CoverArt } from '@/components/shelf/CoverArt';
import { Spine } from '@/components/shelf/Spine';
import { Dewey } from '@/components/dewey/Dewey';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { LeaderRow, PocketCard } from '@/components/ui/PocketCard';
import { Raised } from '@/components/ui/Raised';
import { TapeNote } from '@/components/ui/TapeNote';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const daysSince = (iso: string) => Math.max(1, Math.round((Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 86400000));

/** Non-interactive status/rating badge — same look as Chip but never a fake button. */
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
  const [moving, setMoving] = useState(false);
  const { data: row } = useQuery({ queryKey: ['book', id], queryFn: () => getLibraryRow(id) });
  const { data: all = [] } = useQuery({ queryKey: ['library'], queryFn: () => listLibrary() });
  const copies = useMemo(() => (row ? listCopiesOfBook(row.bookId) : []), [row]);
  const rooms = useMemo(() => listRooms(), [row]);
  if (!row) return <View style={{ flex: 1, backgroundColor: c.paper }} />;

  const room = row.location?.trim() || UNSHELVED;
  const neighbours = all.filter((r) => (r.location?.trim() || UNSHELVED) === room && r.status !== 'wishlist');
  const at = neighbours.findIndex((r) => r.id === row.id);
  const left = at === -1 ? [] : neighbours.slice(Math.max(0, at - 3), at);
  const right = at === -1 ? [] : neighbours.slice(at + 1, at + 4);
  const loaned = copies.find((cp) => cp.borrower);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['book', id] });
    qc.invalidateQueries({ queryKey: ['library'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
  };

  const primary =
    row.status === 'wishlist'
      ? { label: 'Found it!', run: () => { setStatus(row.id, 'owned'); refresh(); } }
      : loaned
        ? { label: `Nudge ${loaned.borrower}`, run: () => Share.share({ message: `Hi ${loaned.borrower}! How is ${row.book.title} treating you? No rush. (Some rush.)` }) }
        : row.status === 'read'
          ? { label: 'Mark as unread', run: () => { setStatus(row.id, 'owned'); refresh(); } }
          : { label: 'Mark as read', run: () => { setStatus(row.id, 'read'); refresh(); } };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4 }}>
          <Raised offset={2} radius={22}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back to your shelves"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={20} height={20} fill="none" stroke={ink.brown} strokeWidth={2.8}><Path d="M13 4l-7 6 7 6" /></Svg>
            </Pressable>
          </Raised>
        </View>

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

        <View style={{ flexDirection: 'row', gap: 18, paddingHorizontal: 20, paddingTop: 22, alignItems: 'flex-end' }}>
          <Animated.View entering={FadeInUp.duration(600).withInitialValues({ transform: [{ translateY: -120 }, { scale: 0.5 }] })}>
            <View style={{ transform: [{ rotate: '-4deg' }] }}>
              <Raised offset={5} radius={6}>
                <CoverArt id={row.bookId} title={row.book.title} author={row.book.authors[0]} coverUrl={row.book.coverUrl} width={132} height={196} />
              </Raised>
            </View>
          </Animated.View>
          <View style={{ flex: 1, paddingBottom: 6 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 34, lineHeight: 38, color: c.text }}>{row.book.title}</Text>
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.soft, marginTop: 4 }}>{row.book.authors.join(', ')}</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              <Pill label={row.status === 'read' ? 'Read' : row.status === 'wishlist' ? 'Wishlist' : row.status === 'reading' ? 'Reading' : 'On the shelf'} selected />
              {row.rating ? <Pill label={`★ ${row.rating}`} /> : null}
            </View>
          </View>
        </View>

        <PocketCard title={`Pocket card · ${copies.length} ${copies.length === 1 ? 'copy' : 'copies'}`} style={{ marginHorizontal: 16, marginTop: 22 }}>
          {copies.map((cp, i) => (
            <LeaderRow key={cp.id} label={`Copy ${i + 1}`} value={cp.borrower ? `Visiting ${cp.borrower}` : cp.location?.trim() || UNSHELVED} />
          ))}
          {row.book.publisher || row.book.publishedYear ? <LeaderRow label="Edition" value={[row.book.publisher, row.book.publishedYear].filter(Boolean).join(', ')} /> : null}
          <LeaderRow label="ISBN" value={row.book.isbn13 ?? '—'} />
        </PocketCard>

        {loaned?.loanedAt ? (
          <View style={{ marginHorizontal: 16, marginTop: 14, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: ink.tape, borderWidth: 2, borderColor: c.line, borderRadius: 10, padding: 10 }}>
            <Dewey size={38} />
            <Text style={{ flex: 1, fontFamily: font.heavy, fontSize: 13, color: ink.brown }}>
              {`A copy has been visiting ${loaned.borrower} for ${daysSince(loaned.loanedAt)} days.`}
            </Text>
          </View>
        ) : null}

        {moving ? (
          <View style={{ marginHorizontal: 16, marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(rooms.length ? rooms : ['Living room', 'Bedroom', 'Study']).map((r) => (
              <Chip key={r} label={r} selected={r === room} onPress={() => { setLocation(row.id, r); setMoving(false); refresh(); }} />
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 16 }}>
          <Button variant="ghost" flex label={moving ? 'Cancel' : 'Move shelf'} onPress={() => setMoving((m) => !m)} />
          <Button flex label={primary.label} onPress={primary.run} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
