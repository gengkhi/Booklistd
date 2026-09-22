import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { LeaderRow, PocketCard } from '@/components/ui/PocketCard';
import type { AuthMethod } from '@/auth/session';
import { methodLabel } from '@/features/account/accountLines';
import { font, ink } from '@/theme/palette';

/** Profile → Account (spec §5): who you are, the backup line, and the account actions. */
export function AccountCard({
  email, method, backupLine, onBackupPress, onExport, onSignOut, onDelete, busy,
}: {
  email: string | null; method: AuthMethod | null; backupLine: string; onBackupPress?: () => void;
  onExport?: () => void; onSignOut: () => void; onDelete?: () => void; busy?: boolean;
}) {
  const backup = <LeaderRow label="Backup" value={backupLine} />;
  return (
    <PocketCard title="Account">
      {email ? (
        <View style={{ paddingVertical: 4 }} accessible accessibilityLabel={`Signed in as ${email} ${methodLabel(method)}`}>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft }}>Signed in as</Text>
          <Text numberOfLines={1} ellipsizeMode="middle" style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{email}</Text>
          {method ? <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft }}>{methodLabel(method)}</Text> : null}
        </View>
      ) : null}
      {onBackupPress ? <Pressable accessibilityRole="button" onPress={onBackupPress}>{backup}</Pressable> : backup}
      <View style={{ gap: 10, marginTop: 10, marginBottom: 4 }}>
        {onExport ? <Button label="Export my library (CSV)" variant="ghost" disabled={busy} onPress={onExport} /> : null}
        <Button label="Sign out" variant="ghost" disabled={busy} onPress={onSignOut} />
        {onDelete ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={onDelete} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 6 }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: ink.tomato, textDecorationLine: 'underline' }}>Delete account</Text>
          </Pressable>
        ) : null}
      </View>
    </PocketCard>
  );
}
