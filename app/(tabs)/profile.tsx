import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { libraryStats, listShelves } from '@/db/repository';
import { Chip } from '@/components/ui/Chip';
import { LeaderRow, PocketCard } from '@/components/ui/PocketCard';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Dewey } from '@/components/dewey/Dewey';
import { useSettings } from '@/stores/settings';
import type { ThemePref } from '@/theme/resolveScheme';
import { font } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'Match phone' },
  { value: 'light', label: 'Daylight' },
  { value: 'lamp', label: 'Lamplight' },
];

function Label({ children }: { children: string }) {
  const { c } = useTheme();
  return <Text style={{ fontFamily: font.black, fontSize: 13, color: c.text, marginTop: 24, marginBottom: 10 }}>{children}</Text>;
}

export default function ProfileScreen() {
  const { c } = useTheme();
  const { theme, setTheme, quiet, setQuiet } = useSettings();
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => libraryStats() });
  const { data: shelves = [] } = useQuery({ queryKey: ['shelves'], queryFn: () => listShelves() });
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <ScreenHeader title="Profile" />
        <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
          <PocketCard title="Library card">
            <LeaderRow label="Books on shelves" value={String(stats?.totalBooks ?? 0)} />
            <LeaderRow label="Shelves" value={String(shelves.length)} />
            <LeaderRow label="Visiting friends" value={String(stats?.activeLoans ?? 0)} />
            <LeaderRow label="On the wishlist" value={String(stats?.wishlist ?? 0)} />
            {stats?.estValue ? <LeaderRow label="Estimated value" value={`$${stats.estValue.toFixed(0)}`} /> : null}
          </PocketCard>

          <Label>Light</Label>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {THEMES.map((t) => <Chip key={t.value} label={t.label} selected={theme === t.value} onPress={() => setTheme(t.value)} />)}
          </View>

          <Label>Dewey</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Dewey mood={quiet ? 'sleep' : 'happy'} size={48} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip label="Chatty" selected={!quiet} onPress={() => setQuiet(false)} />
              <Chip label="Quiet librarian" selected={quiet} onPress={() => setQuiet(true)} />
            </View>
          </View>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: c.soft, marginTop: 8 }}>
            Quiet hides Dewey's remarks and the shelf notes. Shelf names and counts stay.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
