import React, { useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Svg, { Path } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';
import { useScanPipeline } from '@/features/scanner/useScanPipeline';
import { ScanViewfinder } from '@/features/scanner/ScanViewfinder';
import { VerdictSheet } from '@/features/scanner/VerdictSheet';
import { addUserBook, libraryStats, listRooms, upsertBook } from '@/db/repository';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { useSettings } from '@/stores/settings';
import { font, ink, radius } from '@/theme/palette';

const DEFAULT_ROOMS = ['Living room', 'Bedroom', 'Study'];
const SCENE = '#1B130D';

function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Close Store Mode"
      style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: ink.brown, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={18} height={18} stroke={ink.brown} strokeWidth={3}><Path d="M3 3l12 12M15 3L3 15" /></Svg>
    </Pressable>
  );
}

export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const quiet = useSettings((s) => s.quiet);
  const [permission, requestPermission] = useCameraPermissions();
  const { current, sessionCount, onBarcode, dismiss } = useScanPipeline();
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const rooms = useMemo(() => {
    const r = listRooms();
    return r.length ? r : DEFAULT_ROOMS;
  }, [current?.isbn13]); // refresh when a new book is scanned

  const close = () => router.navigate('/');

  const addAs = (status: 'owned' | 'wishlist', room: string | null) => {
    if (!current) return;
    const { verdict, meta, isbn13 } = current;
    const book =
      verdict.book ??
      upsertBook(meta ?? {
        isbn13, isbn10: null, title: `ISBN ${isbn13}`, subtitle: null, authors: [], publisher: null, publishedYear: null,
        edition: null, genres: [], pageCount: null, coverUrl: null, description: null, workKey: null, source: 'manual',
      });
    addUserBook(book.id, status, status === 'owned' ? room ?? undefined : undefined);
    qc.invalidateQueries({ queryKey: ['library'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    const total = libraryStats().totalBooks;
    dismiss();
    setToast(status === 'owned' ? `Shelved in ${room ?? 'Unshelved'}. Book #${total}.` : 'Wishlisted. The Someday shelf grows.');
    setTimeout(() => setToast(null), 1800);
  };

  if (!permission) return <View style={{ flex: 1, backgroundColor: SCENE }} />;
  if (!permission.granted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: SCENE, padding: 28, justifyContent: 'center' }}>
        <View style={{ position: 'absolute', top: insets.top + 8, left: 16 }}><CloseButton onPress={close} /></View>
        <Text style={{ fontFamily: font.display, fontSize: 32, lineHeight: 36, color: ink.white }}>Point, scan, know instantly</Text>
        <Text style={{ fontFamily: font.bold, fontSize: 15, lineHeight: 21, color: '#D9C3A0', marginTop: 10 }}>
          My Library needs the camera to read book barcodes. Nothing is recorded or uploaded.
        </Text>
        <View style={{ marginTop: 24 }}>
          {permission.canAskAgain ? (
            <Button label="Allow camera" onPress={requestPermission} />
          ) : (
            <Button label="Open Settings" onPress={() => Linking.openSettings()} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: SCENE }}>
      <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['ean13'] }} onBarcodeScanned={({ data }) => onBarcode(data)} />
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', alignItems: 'center' }}>
        <CloseButton onPress={close} />
        <View style={{ flex: 1, alignItems: 'center', marginRight: 44 }}>
          <View style={{ backgroundColor: ink.bus, borderWidth: 2.5, borderColor: ink.brown, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 }}>
            <Text style={{ fontFamily: font.black, fontSize: 12, letterSpacing: 0.8, color: ink.brown }}>{`STORE MODE · ${sessionCount} SCANNED`}</Text>
          </View>
        </View>
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 100, left: 0, right: 0, alignItems: 'center' }}>
        <ScanViewfinder locked={!!current} />
        {!current ? <Text style={{ fontFamily: font.heavy, fontSize: 14, color: ink.paper, marginTop: 18 }}>Point at a barcode. I'll do the rest.</Text> : null}
      </View>
      {current ? (
        <VerdictSheet key={current.isbn13} result={current} rooms={rooms} quiet={quiet} onKeepScanning={dismiss} onAdd={addAs} />
      ) : null}
      <Toast text={toast} />
    </View>
  );
}
