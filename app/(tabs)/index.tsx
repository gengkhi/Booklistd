import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { listLibrary, libraryStats } from '@/db/repository';
import { BookCover } from '@/components/BookCover';
import { colors, font, radius, shadow, space } from '@/theme/tokens';

export default function LibraryScreen() {
  const { data: rows = [] } = useQuery({ queryKey: ['library'], queryFn: () => listLibrary() });
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => libraryStats() });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={['top']}>
      <View style={{ paddingHorizontal: space(4.5), paddingTop: space(2) }}>
        <Text style={{ fontFamily: font.bodyBold, fontSize: 12.5, color: colors.muted }}>
          Good evening, Sean
        </Text>
        <Text style={{ fontFamily: font.display, fontSize: 30, color: colors.ink }}>My Library</Text>
        <Text style={{ fontFamily: font.body, fontSize: 12, color: colors.muted, marginTop: 2 }}>
          {stats ? `${stats.totalBooks} books \u00B7 worth about $${stats.estValue.toFixed(0)}` : ' '}
        </Text>
      </View>

      {rows.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(8) }}>
          <Text style={{ fontFamily: font.displaySemi, fontSize: 20, color: colors.ink, textAlign: 'center' }}>
            Your shelves are waiting
          </Text>
          <Text style={{ fontFamily: font.body, fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6 }}>
            Scan your first book to start the collection.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          numColumns={3}
          contentContainerStyle={{ padding: space(4.5), gap: space(3.5) }}
          columnWrapperStyle={{ gap: space(3.5) }}
          renderItem={({ item }) => (
            <Link href={{ pathname: '/book/[id]', params: { id: item.id } }} asChild>
              <Pressable style={{ ...shadow.warm, borderRadius: radius.sm }}>
                <BookCover
                  title={item.book.title}
                  author={item.book.authors[0]}
                  coverUrl={item.book.coverUrl}
                />
              </Pressable>
            </Link>
          )}
        />
      )}
    </SafeAreaView>
  );
}
