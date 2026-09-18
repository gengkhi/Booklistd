import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { listLibrary, libraryStats } from '@/db/repository';
import { groupByRoom, mostCopied } from '@/features/shelves/groupByRoom';
import { EMPTY_SHELF, roomNote, shelvesLines } from '@/features/dewey/lines';
import { greeting } from '@/lib/dates';
import { Bookcase } from '@/components/shelf/Bookcase';
import { Shelf } from '@/components/shelf/Shelf';
import { Dewey } from '@/components/dewey/Dewey';
import { Bubble } from '@/components/ui/Bubble';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useSettings } from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';
import { PLANKS, ink } from '@/theme/palette';

const DEWEY_ROOM = 120; // horizontal space kept free for Dewey on his shelf

export default function ShelvesScreen() {
  const router = useRouter();
  const { scheme, c } = useTheme();
  const quiet = useSettings((s) => s.quiet);
  const lamp = scheme === 'lamp';
  const { data: rows = [] } = useQuery({ queryKey: ['library'], queryFn: () => listLibrary() });
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => libraryStats() });

  const rooms = useMemo(() => groupByRoom(rows), [rows]);
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

  const total = stats?.totalBooks ?? 0;
  const loans = stats?.activeLoans ?? 0;
  const sub = total === 0
    ? 'No books yet. The shelves are patient.'
    : `${total} ${total === 1 ? 'book' : 'books'} on ${rooms.length} ${rooms.length === 1 ? 'shelf' : 'shelves'}${loans ? ` · ${loans} visiting ${loans === 1 ? 'friend' : 'friends'}` : ''}`;
  const deweyShelf = Math.min(1, Math.max(0, rooms.length - 1));
  const empty = rooms.length === 0;
  // Lamplight Dewey dozes, except on an empty library: the empty state always speaks.
  const asleep = lamp && !empty;

  const dewey = (
    <>
      <View style={{ position: 'absolute', right: 16, bottom: 18, zIndex: 5 }}>
        <Dewey mood={asleep ? 'sleep' : 'happy'} onPress={quiet || asleep ? undefined : () => setLineIdx((i) => i + 1)} />
      </View>
      {!quiet && !asleep ? <Bubble text={empty ? EMPTY_SHELF : line} width={140} style={{ position: 'absolute', right: 12, top: 30, zIndex: 6 }} /> : null}
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <ScreenHeader kicker={greeting(new Date(), lamp)} title="My Library" sub={sub} />
        <Bookcase style={{ marginHorizontal: 12, marginTop: 14 }}>
          {empty ? (
            <Shelf name="Reserved" count={0} plank={ink.bus} rows={[]} onPressBook={() => {}} reserveRight={DEWEY_ROOM}>
              {dewey}
            </Shelf>
          ) : (
            rooms.map((room, i) => (
              <Shelf
                key={room.name}
                name={room.name}
                count={room.rows.length}
                note={quiet ? null : roomNote(room)}
                plank={PLANKS[i % PLANKS.length]}
                rows={room.rows}
                withPlant={i === 0}
                reserveRight={i === deweyShelf ? DEWEY_ROOM : 0}
                onPressBook={(r) => router.push({ pathname: '/book/[id]', params: { id: r.id } })}
              >
                {i === deweyShelf ? dewey : null}
              </Shelf>
            ))
          )}
        </Bookcase>
        {empty ? (
          <View style={{ marginHorizontal: 20, marginTop: 22 }}>
            <Button label="Scan your first book" onPress={() => router.navigate('/scan')} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
