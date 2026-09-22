import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { PocketCard } from '@/components/ui/PocketCard';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { getBook } from '@/db/repository';
import { BOOK_REJECTS, COVER_REJECTS } from '@/sync/logic';
import { describeReject, discardReject, listRejects, reasonFor, retryReject, type RejectRow } from '@/sync/rejects';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function RejectsScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<RejectRow[]>(() => listRejects());
  const refresh = () => setRows(listRejects());
  const titleFor = (bookId: string) => getBook(bookId)?.title ?? null;
  const discard = (r: RejectRow) =>
    Alert.alert(
      'Discard this change?',
      r.tableName === COVER_REJECTS
        ? "This photo won't be backed up. It stays on this phone for now."
        : r.tableName === BOOK_REJECTS
          ? "This book stays on this phone, but its changes won't be backed up."
          : 'This phone goes back to what your backup has.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { discardReject(r.id); refresh(); } },
      ]
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10} style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.text }}>Done</Text>
        </Pressable>
        <ScreenHeader title="Couldn't sync" sub="These changes stayed on this phone. Try again, or discard them to match your backup." />
        <View style={{ paddingHorizontal: 16, marginTop: 14, gap: 14 }}>
          {rows.length === 0 ? (
            <Text style={{ fontFamily: font.bold, fontSize: 15, color: c.soft }}>Everything's backed up.</Text>
          ) : (
            rows.map((r) => (
              <PocketCard key={r.id}>
                <Text style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{describeReject(r, titleFor)}</Text>
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft, marginTop: 2 }}>{reasonFor(r.errorCode, r.tableName)}</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 4 }}>
                  <Button label="Try again" variant="ghost" flex onPress={() => { retryReject(r.id); refresh(); }} />
                  <Button label="Discard" variant="ghost" flex onPress={() => discard(r)} />
                </View>
              </PocketCard>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
