import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listCurrentlyReading, listLibrary, listShelves, libraryStats, setCopyShelf } from '@/db/repository';
import { groupByShelf, mostCopied, plankColor, UNSHELVED } from '@/features/shelves/shelfRules';
import { useRemoveCopy } from '@/features/shelves/useRemoveCopy';
import { EMPTY_SHELF, roomNote, shelvesLines } from '@/features/dewey/lines';
import { todayIso } from '@/features/reading/readingLogic';
import { greeting } from '@/lib/dates';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import type { LibraryRow } from '@/lib/types';
import { Bookcase } from '@/components/shelf/Bookcase';
import { Shelf } from '@/components/shelf/Shelf';
import { DragProvider } from '@/components/shelf/DragLayer';
import { ShelfPicker } from '@/components/shelves/ShelfPicker';
import { Dewey } from '@/components/dewey/Dewey';
import { CurrentlyReadingStrip } from '@/components/reading/CurrentlyReadingStrip';
import { Bubble } from '@/components/ui/Bubble';
import { Button } from '@/components/ui/Button';
import { CardSheet } from '@/components/ui/CardSheet';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useSettings } from '@/stores/settings';
import { useToast } from '@/stores/toast';
import { useTheme } from '@/theme/useTheme';
import { font, ink } from '@/theme/palette';

const DEWEY_ROOM = 120; // horizontal space kept free for Dewey on his shelf

export default function ShelvesScreen() {
  const router = useRouter();
  const { scheme, c } = useTheme();
  const quiet = useSettings((s) => s.quiet);
  const lamp = scheme === 'lamp';
  const { data: rows = [] } = useQuery({ queryKey: ['library'], queryFn: () => listLibrary() });
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => libraryStats() });
  const { data: current = [] } = useQuery({ queryKey: ['reading', 'current'], queryFn: () => listCurrentlyReading() });

  const { data: shelves = [] } = useQuery({ queryKey: ['shelves'], queryFn: () => listShelves() });
  const rooms = useMemo(() => groupByShelf(rows, shelves), [rows, shelves]);
  const lines = useMemo(
    () => shelvesLines({
      totalBooks: stats?.totalBooks ?? 0,
      rooms: rooms.map((r) => ({ name: r.name, count: r.rows.length })),
      mostCopied: mostCopied(rows),
      loaned: stats?.activeLoans ?? 0,
    }),
    [rows, rooms, stats]
  );
  const [lineIdx, setLineIdx] = useState(0);
  const line = lines[lineIdx % lines.length];

  const qc = useQueryClient();
  const showToast = useToast((s) => s.show);
  const removeCopy = useRemoveCopy();
  const scroll = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const contentH = useRef(0);
  const viewH = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [edgeDir, setEdgeDir] = useState<-1 | 0 | 1>(0);
  const [tick, setTick] = useState(0);
  const [moveRow, setMoveRow] = useState<LibraryRow | null>(null);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // ShelfPicker's "+ New shelf" selects the new shelf before the shelves query refetches; keep its name for the toast.
  const createdShelf = useRef<{ id: string; name: string } | null>(null);
  const moveTo = (row: LibraryRow, shelfId: string | null) => {
    setCopyShelf(row.id, shelfId);
    invalidateLibrary(qc);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const name = shelves.find((s) => s.id === shelfId)?.name ?? (shelfId && createdShelf.current?.id === shelfId ? createdShelf.current.name : UNSHELVED);
    showToast(`Moved to ${name}.`);
  };

  // Auto-scroll while a dragged spine sits near the top/bottom edge. Zones re-measure every ~6th step (~100ms)
  // and once when auto-scroll stops, so they're fresh for the drop.
  useEffect(() => {
    if (!dragging || edgeDir === 0) return;
    let steps = 0;
    const t = setInterval(() => {
      const max = Math.max(0, contentH.current - viewH.current);
      const next = Math.min(max, Math.max(0, scrollY.current + edgeDir * 12));
      if (next === scrollY.current) return;
      scrollY.current = next;
      scroll.current?.scrollTo({ y: next, animated: false });
      steps += 1;
      if (steps % 6 === 0) setTick((n) => n + 1);
    }, 16);
    return () => {
      clearInterval(t);
      if (steps > 0) setTick((n) => n + 1);
    };
  }, [dragging, edgeDir]);

  const total = stats?.totalBooks ?? 0;
  const loans = stats?.activeLoans ?? 0;
  const sub = total === 0
    ? 'No books yet. The shelves are patient.'
    : `${total} ${total === 1 ? 'book' : 'books'} on ${rooms.length} ${rooms.length === 1 ? 'shelf' : 'shelves'}${loans ? ` · ${loans} visiting ${loans === 1 ? 'friend' : 'friends'}` : ''}`;
  const deweyShelf = Math.min(1, Math.max(0, rooms.length - 1));
  const empty = rooms.length === 0;
  const noBooks = total === 0;
  // Lamplight Dewey dozes, except with no books at all: the empty state always speaks.
  const asleep = lamp && !noBooks;

  const dewey = (
    <>
      <View style={{ position: 'absolute', right: 16, bottom: 18, zIndex: 5 }}>
        <Dewey mood={asleep ? 'sleep' : 'happy'} onPress={quiet || asleep ? undefined : () => setLineIdx((i) => i + 1)} />
      </View>
      {!quiet && !asleep ? <Bubble text={noBooks ? EMPTY_SHELF : line} width={140} style={{ position: 'absolute', right: 12, top: 30, zIndex: 6 }} /> : null}
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <DragProvider
        remeasureKey={tick}
        rowsById={rowsById}
        onDraggingChange={setDragging}
        onEdge={setEdgeDir}
        onDrop={(row, zone) => (zone.kind === 'bin' ? removeCopy(row.id) : moveTo(row, zone.id))}
      >
        <ScrollView ref={scroll} scrollEnabled={!dragging} scrollEventThrottle={32}
          onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
          onContentSizeChange={(_w, h) => { contentH.current = h; }}
          onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}
          onMomentumScrollEnd={() => { if (dragging) setTick((n) => n + 1); }}
          onScrollEndDrag={() => { if (dragging) setTick((n) => n + 1); }}
          contentContainerStyle={{ paddingBottom: 110 }}>
          <ScreenHeader kicker={greeting(new Date(), lamp)} title="Booklistd" sub={sub} />
          <Pressable onPress={() => router.push('/shelves')} accessibilityRole="button" hitSlop={8}
            style={{ alignSelf: 'flex-start', marginHorizontal: 20, marginTop: 4, minHeight: 32, justifyContent: 'center' }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 13, color: c.text, textDecorationLine: 'underline' }}>Manage shelves</Text>
          </Pressable>
          {!empty || current.length ? (
            <CurrentlyReadingStrip
              rows={current}
              today={todayIso()}
              onOpen={(bookId) => router.push({ pathname: '/book/[id]', params: { id: bookId } })}
              onSeeAll={() => router.push({ pathname: '/reading', params: { state: 'reading' } })}
              onPickFromPile={() => router.push({ pathname: '/reading', params: { state: 'want' } })}
            />
          ) : null}
          <Bookcase style={{ marginHorizontal: 12, marginTop: 14 }}>
            {empty ? (
              <Shelf name="Reserved" count={0} plank={ink.bus} rows={[]} onPressBook={() => {}} reserveRight={DEWEY_ROOM}>
                {dewey}
              </Shelf>
            ) : (
              rooms.map((room, i) => (
                <Shelf
                  key={room.shelf?.id ?? 'unshelved'}
                  name={room.name}
                  count={room.rows.length}
                  note={room.rows.length === 0 ? 'Nothing here yet' : quiet ? null : roomNote(room)}
                  plank={room.shelf ? plankColor(room.shelf.plank) : ink.cream}
                  rows={room.rows}
                  withPlant={i === 0}
                  reserveRight={i === deweyShelf ? DEWEY_ROOM : 0}
                  onPressBook={(r) => router.push({ pathname: '/book/[id]', params: { id: r.id } })}
                  draggable
                  dropId={room.shelf?.id ?? null}
                  onBookAction={(r, a) => (a === 'remove' ? removeCopy(r.id) : setMoveRow(r))}
                >
                  {i === deweyShelf ? dewey : null}
                </Shelf>
              ))
            )}
            {/* No Unshelved group to drop on: offer one for the length of the drag. */}
            {dragging && !rooms.some((r) => !r.shelf) ? (
              <Shelf name={UNSHELVED} count={0} note="Drop here to unshelve" plank={ink.cream} rows={[]}
                onPressBook={() => {}} draggable dropId={null} />
            ) : null}
          </Bookcase>
          {noBooks ? (
            <View style={{ marginHorizontal: 20, marginTop: 22 }}>
              <Button label="Scan your first book" onPress={() => router.navigate('/scan')} />
            </View>
          ) : null}
        </ScrollView>
        <CardSheet visible={!!moveRow} title="Move to shelf" onClose={() => setMoveRow(null)}>
          {moveRow ? (
            <ShelfPicker shelves={shelves} selected={moveRow.shelfId}
              onSelect={(sid) => { if (sid !== moveRow.shelfId) moveTo(moveRow, sid); setMoveRow(null); }} onCreated={(s) => { createdShelf.current = { id: s.id, name: s.name }; invalidateLibrary(qc); }} />
          ) : null}
        </CardSheet>
      </DragProvider>
    </SafeAreaView>
  );
}
