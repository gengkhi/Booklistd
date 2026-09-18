import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { libraryStats } from '@/db/repository';
import { colors, font, radius, shadow, space } from '@/theme/tokens';

function CardRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      <Text style={{ fontFamily: font.bodyBold, fontSize: 12.5, color: colors.inkSoft }}>{label}</Text>
      <View style={{ flex: 1, borderBottomWidth: 2, borderStyle: 'dotted', borderColor: '#D9C49B', marginHorizontal: 8, marginBottom: 4 }} />
      <Text style={{ fontFamily: font.display, fontSize: 16, color: colors.ink }}>{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => libraryStats() });
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={['top']}>
      <View style={{ padding: space(4.5), gap: space(3) }}>
        <Text style={{ fontFamily: font.display, fontSize: 30, color: colors.ink }}>Profile</Text>
        <View
          style={{
            backgroundColor: '#FFF9EA',
            borderWidth: 1.5,
            borderColor: '#E4CFA4',
            borderRadius: radius.lg,
            padding: space(4.5),
            gap: space(2.75),
            ...shadow.warm,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1.5, borderColor: '#E4CFA4', paddingBottom: 9 }}>
            <Text style={{ fontFamily: font.displaySemi, fontSize: 15, letterSpacing: 1.5, color: colors.ink }}>LIBRARY CARD</Text>
          </View>
          <CardRow label="Books owned" value={String(stats?.totalBooks ?? 0)} />
          <CardRow label="Estimated value" value={`$${(stats?.estValue ?? 0).toFixed(0)}`} />
        </View>
        <Text style={{ fontFamily: font.body, fontSize: 12.5, color: colors.muted }}>
          Phase 3 lands here: sign in with Apple/Google, backup and sync, CSV import/export, Lamplight mode.
        </Text>
      </View>
    </SafeAreaView>
  );
}
