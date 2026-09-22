import React from 'react';
import { FlatList, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { LibraryRow } from '@/lib/types';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';
import { TapeNote } from '@/components/ui/TapeNote';
import { Spine } from './Spine';
import { Plant } from './Plant';
import { DraggableSpine, useDraggingId, useDropZone } from './DragLayer';

export function Shelf({
  name, count, note, plank, rows, onPressBook, reserveRight = 0, withPlant, children, dropId, draggable, onBookAction,
}: {
  name: string; count: number; note?: string | null; plank: string; rows: LibraryRow[];
  onPressBook: (row: LibraryRow) => void; reserveRight?: number; withPlant?: boolean; children?: React.ReactNode;
  /** The shelf id this row drops onto; null = Unshelved. */
  dropId?: string | null;
  /** Spines can be held and dragged (needs a DragProvider above). */
  draggable?: boolean;
  /** VoiceOver actions on each spine. */
  onBookAction?: (row: LibraryRow, action: 'move' | 'remove') => void;
}) {
  const { c } = useTheme();
  const zone = useDropZone(`shelf:${dropId ?? 'unshelved'}`, dropId ?? null, 'shelf');
  const draggingId = useDraggingId();
  return (
    <View ref={draggable ? zone.ref : undefined} onLayout={draggable ? zone.onLayout : undefined}
      style={{ position: 'relative' }} accessibilityLabel={`${name} shelf, ${count} books`}>
      {draggable ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 4, right: 4, top: 2, bottom: 2, borderWidth: 3, borderStyle: 'dashed', borderColor: c.line, borderRadius: 8, backgroundColor: '#F4B41A33' }, zone.highlightStyle]} />
      ) : null}
      {/* Virtualized: a room can hold hundreds of spines (spec §7). */}
      <FlatList
        horizontal
        data={rows}
        keyExtractor={(r) => r.id}
        initialNumToRender={12}
        windowSize={5}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'flex-end', gap: 2, paddingHorizontal: 14, paddingTop: 34, paddingRight: 14 + reserveRight, minHeight: 156 }}
        extraData={draggingId}
        renderItem={({ item: r, index: i }) => {
          const spine = (
            <Spine id={r.id} title={r.book.title} onPress={() => onPressBook(r)} lean={i === rows.length - 1 && rows.length >= 4 ? -10 : 0}
              hidden={draggingId === r.id}
              accessibilityActions={onBookAction ? [{ name: 'move', label: 'Move to shelf…' }, { name: 'remove', label: 'Remove from shelves' }] : undefined}
              onAccessibilityAction={onBookAction ? (e) => onBookAction(r, e.nativeEvent.actionName === 'remove' ? 'remove' : 'move') : undefined} />
          );
          return draggable ? <DraggableSpine rowId={r.id}>{spine}</DraggableSpine> : spine;
        }}
        ListFooterComponent={withPlant ? <View style={{ marginLeft: 10 }}><Plant /></View> : null}
      />
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
