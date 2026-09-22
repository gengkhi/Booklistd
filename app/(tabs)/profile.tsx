import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { libraryStats, listShelves } from '@/db/repository';
import { AccountCard } from '@/components/account/AccountCard';
import { Chip } from '@/components/ui/Chip';
import { LeaderRow, PocketCard } from '@/components/ui/PocketCard';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Dewey } from '@/components/dewey/Dewey';
import { useSession } from '@/auth/session';
import { SIGN_IN_AGAIN } from '@/features/account/accountLines';
import { signOutOrReport } from '@/features/account/signOut';
import { exportLibraryWithToast } from '@/features/export/shareCsv';
import { useSettings } from '@/stores/settings';
import { useToast } from '@/stores/toast';
import { requestSync, settleSync, syncNow } from '@/sync/engine';
import { statusLine, useSyncStatus } from '@/sync/status';
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

function confirmSignOut(message: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert('Sign out?', message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Sign out', style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) })
  );
}

export default function ProfileScreen() {
  const { c } = useTheme();
  const { theme, setTheme, quiet, setQuiet } = useSettings();
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => libraryStats() });
  const { data: shelves = [] } = useQuery({ queryKey: ['shelves'], queryFn: () => listShelves() });
  const router = useRouter();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const expired = session.status === 'expired';
  const sync = useSyncStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const showToast = useToast((s) => s.show);
  const onExport = () => exportLibraryWithToast(showToast);
  const onSignOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // A failure keeps you signed in: say so, and restart the sync that settleSync stopped.
      const reportFailure = (message: string) => {
        showToast(message);
        requestSync(0);
      };
      const done = await signOutOrReport({ push: () => syncNow(), settle: settleSync, syncEnabled: true, confirm: confirmSignOut }, reportFailure);
      if (done) router.replace('/welcome');
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <ScreenHeader title="Profile" />
        <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
          <AccountCard
            email={session.email}
            method={session.method}
            backupLine={expired ? SIGN_IN_AGAIN : statusLine(sync, now)}
            onBackupPress={expired ? () => router.push('/welcome') : sync.rejected > 0 ? () => router.push('/account/rejects') : undefined}
            onExport={onExport}
            onSignOut={onSignOut}
            onDelete={() => router.push('/account/delete')}
            busy={busy}
          />
          <PocketCard title="Library card" style={{ marginTop: 16 }}>
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
