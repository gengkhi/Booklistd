import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { getLibraryRow } from '@/db/repository';
import { BookCover } from '@/components/BookCover';
import { colors, font, radius, shadow, space } from '@/theme/tokens';

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#F3E8D2' }}>
      <Text style={{ fontFamily: font.bodyBold, fontSize: 12, color: colors.muted }}>{label}</Text>
      <Text style={{ fontFamily: font.bodyHeavy, fontSize: 13, color: colors.ink }}>{value}</Text>
    </View>
  );
}

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: row } = useQuery({ queryKey: ['book', id], queryFn: () => getLibraryRow(id) });
  if (!row) return <View style={{ flex: 1, backgroundColor: colors.ground }} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: space(4.5), gap: space(3.5) }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Back to library"
          style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: '#EBDCC0', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.ink} />
        </Pressable>

        <View style={{ alignItems: 'center' }}>
          <View
            style={{
              width: 246,
              height: 300,
              borderTopLeftRadius: 123,
              borderTopRightRadius: 123,
              borderBottomLeftRadius: radius.lg,
              borderBottomRightRadius: radius.lg,
              backgroundColor: '#F4E3C2',
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingBottom: 22,
            }}
          >
            <View style={shadow.lifted}>
              <BookCover title={row.book.title} author={row.book.authors[0]} coverUrl={row.book.coverUrl} width={164} height={240} />
            </View>
          </View>
          <Text style={{ fontFamily: font.display, fontSize: 28, color: colors.ink, marginTop: space(3.5) }}>{row.book.title}</Text>
          <Text style={{ fontFamily: font.body, fontSize: 13, color: colors.muted }}>{row.book.authors.join(', ')}</Text>
        </View>

        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, ...shadow.warm }}>
          <MetaRow label="Status" value={row.status.replace('_', ' ')} />
          <MetaRow label="Shelf" value={row.location ?? 'Unshelved'} />
          <MetaRow label="ISBN" value={row.book.isbn13 ?? '\u2014'} />
          <MetaRow label="Edition" value={[row.book.edition, row.book.publisher, row.book.publishedYear].filter(Boolean).join(' \u00B7 ') || '\u2014'} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
