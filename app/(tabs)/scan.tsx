import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Svg, { Path } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';
import { useScanPipeline } from '@/features/scanner/useScanPipeline';
import { ScanViewfinder } from '@/features/scanner/ScanViewfinder';
import { VerdictSheet } from '@/features/scanner/VerdictSheet';
import {
  addUserBook, findBookByIsbn, libraryStats, listShelves, removeCopy, setCopyShelf, setReadingState, setStatus, upsertBook,
} from '@/db/repository';
import { UNSHELVED } from '@/features/shelves/shelfRules';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { useSettings } from '@/stores/settings';
import { font, ink, palettes, radius } from '@/theme/palette';

const SCENE = ink.sceneDark;

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
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const { current, sessionCount, onBarcode, dismiss, reset } = useScanPipeline();
  const [focused, setFocused] = useState(false);
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const [shelfVersion, setShelfVersion] = useState(0);
  const shelves = useMemo(() => listShelves(), [current?.isbn13, shelfVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const shelfName = (id: string | null) => shelves.find((s) => s.id === id)?.name ?? UNSHELVED;

  // The camera only lives while Store Mode is on screen; each visit starts a fresh session.
  useFocusEffect(
    useCallback(() => {
      reset();
      setFocused(true);
      return () => setFocused(false);
    }, [reset])
  );

  // Permission granted in the system Settings app is picked up when we come back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);

  // Scanning a book that's already on the Someday shelf: adding it moves that copy instead of duplicating it.
  const wishCopy = current && !current.verdict.owned ? current.verdict.wishlistCopies[0] ?? null : null;

  // A new scan (or dismissal back to no current book) clears the double-tap guard.
  useEffect(() => {
    busyRef.current = false;
  }, [current?.isbn13]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const close = () => router.navigate('/');

  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };

  /** The scanned edition as a catalog row (placeholder when no catalog knew it). */
  const scannedBook = () => {
    const { meta, isbn13 } = current!;
    return (
      (meta ? upsertBook(meta) : findBookByIsbn(isbn13)) ??
      upsertBook({
        isbn13, isbn10: null, title: `ISBN ${isbn13}`, subtitle: null, authors: [], publisher: null, publishedYear: null,
        edition: null, genres: [], pageCount: null, coverUrl: null, description: null, workKey: null, source: 'manual',
      })
    );
  };

  const addAs = (status: 'owned' | 'wishlist', shelfId: string | null) => {
    if (!current || busyRef.current) return;
    busyRef.current = true;
    let message: string;
    // Always the scanned edition — on a work match verdict.book is the sibling edition already owned.
    const bookId = scannedBook().id;
    if (status === 'owned' && wishCopy && wishCopy.bookId === bookId) {
      setStatus(wishCopy.id, 'owned');
      setCopyShelf(wishCopy.id, shelfId);
      message = `Moved off the Someday shelf. Shelved in ${shelfName(shelfId)}.`;
    } else {
      addUserBook(bookId, status, status === 'owned' ? shelfId : null);
      // Another edition's wishlist copy is fulfilled by this one; never relabel it as the wrong edition.
      if (status === 'owned' && wishCopy) removeCopy(wishCopy.id);
      message =
        status === 'owned'
          ? `Shelved in ${shelfName(shelfId)}. Book #${libraryStats().totalBooks}.`
          : quiet ? 'Added to your wishlist.' : 'Wishlisted. The Someday shelf grows.';
    }
    invalidateLibrary(qc);
    dismiss();
    showToast(message);
  };

  const wantToRead = () => {
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setReadingState(scannedBook().id, 'want');
    invalidateLibrary(qc);
    dismiss();
    showToast('On your TBR pile.');
  };

  const addDetails = (shelfId: string | null) => {
    if (!current) return;
    const isbn = current.isbn13;
    dismiss();
    router.push({ pathname: '/book/edit', params: shelfId ? { isbn, shelfId } : { isbn } });
  };

  const statusBar = focused ? <StatusBar style="light" /> : null;
  if (!permission) return <View style={{ flex: 1, backgroundColor: SCENE }}>{statusBar}</View>;
  if (!permission.granted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: SCENE, padding: 28, justifyContent: 'center' }}>
        {statusBar}
        <View style={{ position: 'absolute', top: insets.top + 8, left: 16 }}><CloseButton onPress={close} /></View>
        <Text style={{ fontFamily: font.display, fontSize: 32, lineHeight: 36, color: ink.white }}>Point, scan, know instantly</Text>
        <Text style={{ fontFamily: font.bold, fontSize: 15, lineHeight: 21, color: palettes.lamp.soft, marginTop: 10 }}>
          Booklistd needs the camera to read book barcodes. Nothing is recorded or uploaded.
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
      {statusBar}
      {focused ? (
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['ean13'] }}
          onBarcodeScanned={current ? undefined : ({ data }) => onBarcode(data)}
        />
      ) : (
        <View style={{ flex: 1 }} />
      )}
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
        {!current ? (
          <Text style={{ fontFamily: font.heavy, fontSize: 14, color: ink.paper, marginTop: 18 }}>
            {quiet ? 'Point at a barcode.' : "Point at a barcode. I'll do the rest."}
          </Text>
        ) : null}
      </View>
      {current ? (
        <VerdictSheet key={current.isbn13} result={current} shelves={shelves} quiet={quiet} onKeepScanning={dismiss} onAdd={addAs} onAddDetails={addDetails} onWantToRead={wantToRead} onShelvesChanged={() => { setShelfVersion((v) => v + 1); invalidateLibrary(qc); }} />
      ) : null}
      <Toast text={toast} />
    </View>
  );
}
