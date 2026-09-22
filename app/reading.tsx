import React, { useMemo, useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import { listReadings } from '@/db/repository';
import type { ReadingRow, ReadingState } from '@/lib/types';
import { dayNumber, formatShortDate, groupReadByYear, READING_LABEL, READING_STATES, todayIso } from '@/features/reading/readingLogic';
import { reactionFor } from '@/features/rating/reactions';
import { CoverArt } from '@/components/shelf/CoverArt';
import { Dewey } from '@/components/dewey/Dewey';
import { Chip } from '@/components/ui/Chip';
import { Raised } from '@/components/ui/Raised';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const EMPTY: Record<ReadingState, string> = {
  reading: 'Nothing on the go right now.',
  want: 'Your TBR pile is empty. For now.',
  read: 'No finished books yet.',
  dnf: 'No books abandoned. Yet.',
};

/** Screen order (spec §5.2): what's on the go first. Detail chips keep READING_STATES order. */
const SEGMENTS: readonly ReadingState[] = ['reading', 'want', 'read', 'dnf'];

const OWNERSHIP_HINT = { owned: 'At home', wishlist: 'On your wishlist' } as const;

function Row({ r, today, onPress }: { r: ReadingRow; today: string; onPress: () => void }) {
  const { c } = useTheme();
  const face = reactionFor(r.rating);
  const when =
    r.state === 'reading' ? (r.startedAt ? `Day ${dayNumber(r.startedAt, today)}` : null)
      : r.state === 'read' || r.state === 'dnf' ? (r.finishedAt ? `Finished ${formatShortDate(r.finishedAt, today)}` : null)
        : null;
  const sub = [r.book.authors[0], when, r.ownership ? OWNERSHIP_HINT[r.ownership] : null].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${r.book.title}, ${sub}${face ? `, ${face.label}` : ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 10, backgroundColor: ink.white, borderWidth: 2, borderColor: c.line, borderRadius: 12, padding: 10, minHeight: 76 }}>
      <CoverArt id={r.bookId} title={r.book.title} coverUrl={r.book.coverUrl} bookId={r.bookId} coverPending={r.book.coverPending} coverObject={r.book.coverObject} width={40} height={60} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{r.book.title}</Text>
        {sub ? <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.soft, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {face ? <Dewey mood={face.mood} size={34} still /> : null}
    </Pressable>
  );
}

export default function ReadingScreen() {
  const params = useLocalSearchParams<{ state?: string }>();
  const router = useRouter();
  const { c } = useTheme();
  const initial = (READING_STATES as readonly string[]).includes(params.state ?? '') ? (params.state as ReadingState) : 'reading';
  const [seg, setSeg] = useState<ReadingState>(initial);
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['reading', seg], queryFn: () => listReadings(seg) });
  const today = todayIso();
  // The Read history grows without bound, so rows are virtualized, grouped by year.
  const sections = useMemo(() => {
    if (!rows.length) return [];
    const groups = seg === 'read' ? groupReadByYear(rows) : [{ year: '', items: rows }];
    return groups.map((g) => ({ key: g.year || 'all', year: g.year, data: g.items }));
  }, [rows, seg]);
  const open = (bookId: string) => router.push({ pathname: '/book/[id]', params: { id: bookId } });

  const header = (
    <>
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <Raised offset={2} radius={22} style={{ alignSelf: 'flex-start' }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={20} height={20} fill="none" stroke={ink.brown} strokeWidth={2.8}><Path d="M13 4l-7 6 7 6" /></Svg>
          </Pressable>
        </Raised>
      </View>
      <ScreenHeader title="Reading" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 16, marginTop: 12, marginBottom: 8 }}>
        {SEGMENTS.map((s) => <Chip key={s} label={READING_LABEL[s]} selected={seg === s} onPress={() => setSeg(s)} />)}
      </View>
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={header}
        ListEmptyComponent={!isLoading ? (
          <Text style={{ marginHorizontal: 20, marginTop: 16, fontFamily: font.bold, fontSize: 14, color: c.soft }}>{EMPTY[seg]}</Text>
        ) : null}
        renderSectionHeader={({ section }) => (section.year ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 14, marginBottom: 8 }}>
            <View style={{ width: 18, height: 2, backgroundColor: c.text }} />
            <Text accessibilityRole="header" style={{ fontFamily: font.black, fontSize: 13, color: c.text }}>
              {`${section.year} · ${section.data.length} ${section.data.length === 1 ? 'book' : 'books'}`}
            </Text>
          </View>
        ) : null)}
        renderItem={({ item }) => <Row r={item} today={today} onPress={() => open(item.bookId)} />}
      />
    </SafeAreaView>
  );
}
