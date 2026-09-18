import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listLibrary, setStatus } from '@/db/repository';
import { wishlistLine } from '@/features/dewey/lines';
import { wantedSince } from '@/lib/dates';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { Bookcase } from '@/components/shelf/Bookcase';
import { Shelf } from '@/components/shelf/Shelf';
import { Spine } from '@/components/shelf/Spine';
import { Dewey } from '@/components/dewey/Dewey';
import { Bubble } from '@/components/ui/Bubble';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useSettings } from '@/stores/settings';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function WishlistScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const quiet = useSettings((s) => s.quiet);
  const { data: rows = [] } = useQuery({ queryKey: ['library', 'wishlist'], queryFn: () => listLibrary({ status: 'wishlist' }) });
  const oldest = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const now = new Date();
  const found = (id: string) => {
    setStatus(id, 'owned');
    invalidateLibrary(qc);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <ScreenHeader title="Wishlist" sub={rows.length ? `${rows.length} ${rows.length === 1 ? 'book' : 'books'} you'll "definitely" read` : 'Scan something in a store and tap Wishlist it.'} />
        <Bookcase style={{ marginHorizontal: 12, marginTop: 14 }}>
          <Shelf name="The Someday shelf" count={rows.length} plank={ink.plum} rows={rows} reserveRight={110}
            onPressBook={(r) => router.push({ pathname: '/book/[id]', params: { id: r.id } })}>
            <View style={{ position: 'absolute', right: 14, bottom: 18 }}><Dewey mood="smug" size={56} /></View>
            {!quiet ? <Bubble text={wishlistLine(rows.length)} width={150} style={{ position: 'absolute', right: 12, top: 28 }} /> : null}
          </Shelf>
        </Bookcase>

        {oldest.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 22, marginBottom: 8 }}>
            <View style={{ width: 18, height: 2, backgroundColor: c.text }} />
            <Text style={{ fontFamily: font.black, fontSize: 13, color: c.text }}>Wanted the longest</Text>
          </View>
        ) : null}
        {oldest.map((r) => (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 10, backgroundColor: ink.white, borderWidth: 2, borderColor: c.line, borderRadius: 10, padding: 10 }}>
            <Spine id={r.id} title="" scale={0.45} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{r.book.title}</Text>
              <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.soft, marginTop: 2 }}>{r.book.authors[0] ?? ''}</Text>
              <View style={{ alignSelf: 'flex-start', marginTop: 5, borderWidth: 2, borderColor: ink.plum, borderRadius: 3, paddingHorizontal: 6, transform: [{ rotate: '-3deg' }] }}>
                <Text style={{ fontFamily: font.black, fontSize: 10, color: ink.plum }}>{wantedSince(r.createdAt, now)}</Text>
              </View>
            </View>
            <Pressable onPress={() => found(r.id)} accessibilityRole="button" accessibilityLabel={`Found ${r.book.title}, move to shelves`} hitSlop={6}
              style={{ height: 38, paddingHorizontal: 12, borderWidth: 2, borderColor: c.line, borderRadius: 10, backgroundColor: ink.bus, justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.black, fontSize: 12.5, color: ink.brown }}>Found it!</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
