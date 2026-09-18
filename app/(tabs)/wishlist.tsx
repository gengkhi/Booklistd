import React from 'react';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { listLibrary } from '@/db/repository';
import { BookCover } from '@/components/BookCover';
import { colors, font, space } from '@/theme/tokens';

export default function WishlistScreen() {
  const { data: rows = [] } = useQuery({
    queryKey: ['library', 'wishlist'],
    queryFn: () => listLibrary({ status: 'wishlist' }),
  });
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={['top']}>
      <View style={{ paddingHorizontal: space(4.5), paddingTop: space(2) }}>
        <Text style={{ fontFamily: font.display, fontSize: 30, color: colors.ink }}>Wishlist</Text>
      </View>
      {rows.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(8) }}>
          <Text style={{ fontFamily: font.displaySemi, fontSize: 18, color: colors.ink, textAlign: 'center' }}>
            Nothing wished for yet
          </Text>
          <Text style={{ fontFamily: font.body, fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6 }}>
            Spot something in a store? Scan it and tap Add to Wishlist.
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
            <BookCover title={item.book.title} author={item.book.authors[0]} coverUrl={item.book.coverUrl} />
          )}
        />
      )}
    </SafeAreaView>
  );
}
