import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { LibraryRow } from '@/lib/types';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';
import { TapeNote } from '@/components/ui/TapeNote';
import { Spine } from './Spine';
import { Plant } from './Plant';

export function Shelf({
  name, count, note, plank, rows, onPressBook, reserveRight = 0, withPlant, children,
}: {
  name: string; count: number; note?: string | null; plank: string; rows: LibraryRow[];
  onPressBook: (row: LibraryRow) => void; reserveRight?: number; withPlant?: boolean; children?: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View style={{ position: 'relative' }} accessibilityLabel={`${name} shelf, ${count} books`}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'flex-end', gap: 2, paddingHorizontal: 14, paddingTop: 34, paddingRight: 14 + reserveRight, minHeight: 156 }}
      >
        {rows.map((r, i) => (
          <Spine key={r.id} id={r.id} title={r.book.title} onPress={() => onPressBook(r)} lean={i === rows.length - 1 && rows.length >= 4 ? -10 : 0} />
        ))}
        {withPlant ? <View style={{ marginLeft: 10 }}><Plant /></View> : null}
      </ScrollView>
      <View style={{ height: 16, backgroundColor: plank, borderWidth: 2, borderColor: c.line, marginHorizontal: -2.5 }} />
      <View style={{ position: 'absolute', left: 12, top: 6, flexDirection: 'row', alignItems: 'center', gap: 10 }} pointerEvents="none">
        <View style={{ backgroundColor: c.roomTag, borderWidth: 2, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 11.5, color: ink.brown }}>{`${name} · ${count}`}</Text>
        </View>
        {note ? <TapeNote text={note} /> : null}
      </View>
      {children}
    </View>
  );
}
