import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Circle, Path } from 'react-native-svg';
import { addUserBook, checkOwnership, findWishlistCopy, searchLibrary, upsertBook } from '@/db/repository';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { lookupIsbn } from '@/api/bookLookup';
import { normalizeToIsbn13 } from '@/lib/isbn';
import { searchAside } from '@/features/dewey/lines';
import { UNSHELVED } from '@/features/shelves/groupByRoom';
import { Spine } from '@/components/shelf/Spine';
import { Raised } from '@/components/ui/Raised';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useSettings } from '@/stores/settings';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

function Section({ label, count }: { label: string; count: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 18, marginBottom: 8 }}>
      <View style={{ width: 18, height: 2, backgroundColor: c.text }} />
      <Text style={{ fontFamily: font.black, fontSize: 13, color: c.text }}>{label}</Text>
      <Text style={{ fontFamily: font.bold, fontSize: 13, color: c.soft }}>{`· ${count}`}</Text>
    </View>
  );
}

function ResultRow({ id, title, sub, right, onPress }: { id: string; title: string; sub: string; right: React.ReactNode; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={`${title}, ${sub}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 10, backgroundColor: ink.white, borderWidth: 2, borderColor: c.line, borderRadius: 12, padding: 10, minHeight: 68 }}>
      <Spine id={id} title="" scale={0.45} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{title}</Text>
        <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.soft, marginTop: 2 }}>{sub}</Text>
      </View>
      {right}
    </Pressable>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const quiet = useSettings((s) => s.quiet);
  const [q, setQ] = useState('');
  const term = q.trim();
  const isbn = normalizeToIsbn13(term);
  const { data: mine = [] } = useQuery({ queryKey: ['search', term], queryFn: () => searchLibrary(term), enabled: term.length >= 2 });
  const { data: catalog } = useQuery({ queryKey: ['isbn', isbn], queryFn: () => lookupIsbn(isbn!), enabled: !!isbn });
  const owned = mine.filter((r) => r.status !== 'wishlist' && r.status !== 'want_to_buy');
  const wished = mine.filter((r) => r.status === 'wishlist' || r.status === 'want_to_buy');
  // "+ Add" only for books not already on a shelf or the wishlist (a wishlisted one shows in its own section).
  const { data: gate } = useQuery({
    queryKey: ['search', 'catalog-gate', isbn],
    queryFn: () => {
      const v = checkOwnership(isbn!);
      return { owned: v.owned, wished: !!(v.book && findWishlistCopy(v.book.id)) };
    },
    enabled: !!isbn,
  });
  const canAdd = !!gate && !gate.owned && !gate.wished;

  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = false;
  }, [isbn]);

  const add = () => {
    if (!catalog || !canAdd || busyRef.current) return;
    busyRef.current = true;
    const book = upsertBook(catalog);
    addUserBook(book.id, 'owned');
    invalidateLibrary(qc);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 110 }}>
        <ScreenHeader title="Search" />
        <Raised offset={3} radius={14} style={{ marginHorizontal: 16, marginTop: 12 }}>
          <View style={{ height: 54, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 }}>
            <Svg width={22} height={22} fill="none" stroke={ink.brown} strokeWidth={2.6}><Circle cx={10} cy={10} r={6} /><Path d="M15 15l5 5" /></Svg>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Title, author or ISBN"
              placeholderTextColor={ink.soft}
              accessibilityLabel="Search your shelves"
              autoCorrect={false}
              returnKeyType="search"
              style={{ flex: 1, fontFamily: font.heavy, fontSize: 16, color: ink.brown }}
            />
          </View>
        </Raised>
        {!quiet ? <Text style={{ marginHorizontal: 20, marginTop: 10, fontFamily: font.hand, fontSize: 16, color: c.soft }}>{searchAside(term.length >= 2 ? term : '', owned.length)}</Text> : null}

        {term.length >= 2 ? (
          <>
            <Section label="On your shelves" count={owned.length} />
            {owned.map((r) => (
              <ResultRow key={r.id} id={r.id} title={r.book.title}
                sub={[r.book.authors[0], r.book.publisher, r.book.publishedYear].filter(Boolean).join(' · ')}
                right={<Text style={{ fontFamily: font.black, fontSize: 11.5, color: ink.brown }}>{r.location?.trim() || UNSHELVED}</Text>}
                onPress={() => router.push({ pathname: '/book/[id]', params: { id: r.id } })} />
            ))}
            {wished.length ? (
              <>
                <Section label="On your wishlist" count={wished.length} />
                {wished.map((r) => (
                  <ResultRow key={r.id} id={r.id} title={r.book.title}
                    sub={[r.book.authors[0], r.book.publisher, r.book.publishedYear].filter(Boolean).join(' · ')}
                    right={<Text style={{ fontFamily: font.black, fontSize: 11.5, color: ink.brown }}>Wishlist</Text>}
                    onPress={() => router.push({ pathname: '/book/[id]', params: { id: r.id } })} />
                ))}
              </>
            ) : null}
          </>
        ) : null}

        {isbn && catalog && canAdd ? (
          <>
            <Section label="From the catalog" count={1} />
            <ResultRow id={isbn} title={catalog.title} sub={[catalog.authors[0], catalog.publishedYear].filter(Boolean).join(' · ')}
              right={
                <Pressable onPress={add} accessibilityRole="button" accessibilityLabel={`Add ${catalog.title}`} hitSlop={6}
                  style={{ height: 36, paddingHorizontal: 14, borderWidth: 2, borderColor: c.line, borderRadius: 10, backgroundColor: ink.bus, justifyContent: 'center' }}>
                  <Text style={{ fontFamily: font.black, fontSize: 13, color: ink.brown }}>+ Add</Text>
                </Pressable>
              } />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
