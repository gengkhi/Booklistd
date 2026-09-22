import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ReadingRow } from '@/lib/types';
import { dayNumber } from '@/features/reading/readingLogic';
import { CoverArt } from '@/components/shelf/CoverArt';
import { font } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** "Currently reading" covers above the bookcase. */
export function CurrentlyReadingStrip({ rows, today, onOpen, onSeeAll, onPickFromPile }: {
  rows: ReadingRow[]; today: string; onOpen: (bookId: string) => void; onSeeAll: () => void; onPickFromPile: () => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20 }}>
        <Text accessibilityRole="header" style={{ fontFamily: font.black, fontSize: 14, color: c.text }}>Currently reading</Text>
        <Pressable onPress={onSeeAll} accessibilityRole="button" hitSlop={10} style={{ minHeight: 32, justifyContent: 'center' }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 13, color: c.text, textDecorationLine: 'underline' }}>See all reading</Text>
        </Pressable>
      </View>
      {rows.length === 0 ? (
        <Pressable onPress={onPickFromPile} accessibilityRole="button" style={{ marginHorizontal: 20, marginTop: 6, minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ fontFamily: font.bold, fontSize: 13.5, color: c.soft }}>Nothing on the go. Pick something from your TBR pile.</Text>
        </Pressable>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingTop: 8 }}>
          {rows.map((r) => (
            <Pressable key={r.id} onPress={() => onOpen(r.bookId)} accessibilityRole="button"
              accessibilityLabel={`${r.book.title}${r.startedAt ? `, day ${dayNumber(r.startedAt, today)}` : ''}`} style={{ width: 84 }}>
              <CoverArt id={r.bookId} title={r.book.title} coverUrl={r.book.coverUrl} bookId={r.bookId} coverPending={r.book.coverPending} coverObject={r.book.coverObject} width={84} height={124} />
              <Text numberOfLines={1} style={{ fontFamily: font.heavy, fontSize: 12, color: c.text, marginTop: 6 }}>{r.book.title}</Text>
              {r.startedAt ? <Text style={{ fontFamily: font.bold, fontSize: 11.5, color: c.soft }}>{`Day ${dayNumber(r.startedAt, today)}`}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
