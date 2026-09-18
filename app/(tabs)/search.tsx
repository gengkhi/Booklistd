import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, font, radius, space } from '@/theme/tokens';

/**
 * Phase 1: library-first search (repository LIKE query on title/author/isbn),
 * then catalog search via the book-lookup function's /search mode.
 */
export default function SearchScreen() {
  const [q, setQ] = useState('');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={['top']}>
      <View style={{ padding: space(4.5), gap: space(3.5) }}>
        <Text style={{ fontFamily: font.display, fontSize: 30, color: colors.ink }}>Search</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Title, author or ISBN"
          placeholderTextColor="#8A785E"
          style={{
            height: 50,
            borderRadius: radius.pill,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: '#EBDCC0',
            paddingHorizontal: space(4),
            fontFamily: font.body,
            fontSize: 14,
            color: colors.ink,
          }}
        />
        <Text style={{ fontFamily: font.body, fontSize: 13, color: colors.muted }}>
          On your shelves first, then the catalog. (Phase 1)
        </Text>
      </View>
    </SafeAreaView>
  );
}
