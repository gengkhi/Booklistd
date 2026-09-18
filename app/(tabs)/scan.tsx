import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useQueryClient } from '@tanstack/react-query';
import { useScanPipeline } from '@/features/scanner/useScanPipeline';
import { addUserBook, upsertBook } from '@/db/repository';
import { colors, font, radius, space } from '@/theme/tokens';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const { current, sessionCount, onBarcode, dismiss } = useScanPipeline();
  const qc = useQueryClient();

  const addAs = (status: 'owned' | 'wishlist') => {
    if (!current) return;
    const book =
      current.verdict.book ??
      (current.meta ? upsertBook(current.meta) : null);
    if (!book) return;
    addUserBook(book.id, status);
    qc.invalidateQueries({ queryKey: ['library'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    dismiss();
  };

  if (!permission) return <View style={{ flex: 1, backgroundColor: colors.espresso }} />;
  if (!permission.granted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.espresso, alignItems: 'center', justifyContent: 'center', padding: space(8) }}>
        <Text style={{ fontFamily: font.displaySemi, fontSize: 20, color: colors.creamOnDark, textAlign: 'center' }}>
          Point, scan, know instantly
        </Text>
        <Text style={{ fontFamily: font.body, fontSize: 13, color: colors.mutedOnDark, textAlign: 'center', marginTop: 8 }}>
          My Library needs the camera to read book barcodes.
        </Text>
        <Pressable
          onPress={requestPermission}
          style={{ marginTop: space(5), backgroundColor: colors.clay, paddingHorizontal: space(6), height: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: font.bodyHeavy, fontSize: 14, color: colors.onAccent }}>Allow camera</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const v = current?.verdict;
  return (
    <View style={{ flex: 1, backgroundColor: colors.espresso }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['ean13'] }}
        onBarcodeScanned={({ data }) => onBarcode(data)}
      />
      <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' }} edges={['top']}>
        <View style={{ marginTop: space(2), paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: 'rgba(39,28,17,0.75)', borderWidth: 1, borderColor: 'rgba(239,184,119,0.5)' }}>
          <Text style={{ fontFamily: font.bodyHeavy, fontSize: 11, letterSpacing: 1.4, color: colors.lamplight }}>
            STORE MODE {'\u00B7'} {sessionCount} SCANNED
          </Text>
        </View>
      </SafeAreaView>

      {current && v && (
        <View
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            backgroundColor: v.owned ? colors.owned : colors.ground,
            borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
            padding: space(5.5), paddingBottom: space(8), gap: space(3.5),
          }}
        >
          <Text style={{ fontFamily: font.display, fontSize: 30, color: v.owned ? '#FFF9EC' : colors.ink }}>
            {v.owned ? 'You own this!' : 'A new find!'}
          </Text>
          <Text style={{ fontFamily: font.bodyBold, fontSize: 13, color: v.owned ? '#D7EBD6' : colors.muted }}>
            {v.owned
              ? v.exactIsbnMatch
                ? `${v.copies} ${v.copies === 1 ? 'copy' : 'copies'} in your library${v.userBooks[0]?.location ? ` \u00B7 ${v.userBooks[0].location}` : ''}`
                : `Different edition \u2014 you own ${v.copies} ${v.copies === 1 ? 'copy' : 'copies'} of this title`
              : current.metaLoading
                ? 'Looking it up\u2026'
                : current.meta?.title ?? v.book?.title ?? `ISBN ${current.isbn13}`}
          </Text>
          {!v.owned && current.metaLoading && <ActivityIndicator color={colors.clay} />}
          {!v.owned && !current.metaLoading && (
            <View style={{ flexDirection: 'row', gap: space(2.5) }}>
              <Pressable
                onPress={() => addAs('wishlist')}
                style={{ flex: 1, height: 50, borderRadius: 18, borderWidth: 2, borderColor: colors.clay, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: font.bodyHeavy, fontSize: 14, color: colors.clay }}>Add to Wishlist</Text>
              </Pressable>
              <Pressable
                onPress={() => addAs('owned')}
                style={{ flex: 1, height: 50, borderRadius: 18, backgroundColor: colors.clay, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: font.bodyHeavy, fontSize: 14, color: colors.onAccent }}>Add to Library</Text>
              </Pressable>
            </View>
          )}
          <Pressable onPress={dismiss} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontFamily: font.bodyBold, fontSize: 12.5, textDecorationLine: 'underline', color: v.owned ? '#FFF9EC' : colors.clay }}>
              Keep scanning
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
