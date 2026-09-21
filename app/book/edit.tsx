import React, { useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  addUserBook, findBookByIsbn, getBook, getBookEdit, getCatalogBook, removeBookCover, resetBookEdits,
  saveBookEdit, setBookCover, upsertBook,
} from '@/db/repository';
import { canSave, formFromBook, toEditPatch, yearError, type EditForm } from '@/features/bookEdits/editLogic';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { CoverSlot } from '@/components/bookEdits/CoverSlot';
import { Button } from '@/components/ui/Button';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const BLANK: EditForm = { title: '', authors: '', subtitle: '', publisher: '', year: '', edition: '' };

/** Cover change staged until Save: a newly picked image, a removal, or nothing. */
type CoverChange = { kind: 'none' } | { kind: 'pick'; uri: string } | { kind: 'remove' };

function Field({ label, value, onChange, error, keyboardType, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; error?: string | null;
  keyboardType?: 'default' | 'number-pad'; autoFocus?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontFamily: font.heavy, fontSize: 13, color: c.text }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        accessibilityLabel={label}
        style={{
          marginTop: 6, minHeight: 46, paddingHorizontal: 12, borderWidth: 2, borderColor: error ? ink.tomato : c.line,
          borderRadius: radius.pill / 2, backgroundColor: ink.white, fontFamily: font.bold, fontSize: 16, color: ink.brown,
        }}
      />
      {error ? <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.tomato, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

export default function EditBookScreen() {
  const params = useLocalSearchParams<{ bookId?: string; isbn?: string; room?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const createIsbn = params.bookId ? null : params.isbn ?? null;

  const effective = useMemo(() => (params.bookId ? getBook(params.bookId) : createIsbn ? findBookByIsbn(createIsbn) : null), [params.bookId, createIsbn]);
  const hasEdits = useMemo(() => (effective ? getBookEdit(effective.id) !== null : false), [effective]);
  const [form, setForm] = useState<EditForm>(() => {
    if (!effective) return BLANK;
    const f = formFromBook(effective);
    return /^ISBN \d{13}$/.test(f.title) ? { ...f, title: '' } : f; // don't make them delete the placeholder
  });
  const [more, setMore] = useState(false);
  const [cover, setCover] = useState<CoverChange>({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const notFound = !!params.bookId && !effective;

  const set = (k: keyof EditForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const shownCover = cover.kind === 'pick' ? cover.uri : cover.kind === 'remove' ? null : effective?.coverUrl ?? null;
  const isbn = effective?.isbn13 ?? createIsbn ?? '';
  // Keep the Year field visible whenever it has an error, so a collapsed "More details"
  // can never hide the reason Save is disabled.
  const showMore = more || yearError(form.year) !== null;

  const save = async () => {
    if (!canSave(form) || busy || busyRef.current || notFound) return;
    busyRef.current = true;
    setBusy(true);
    setPhotoError(null);
    setSaveError(null);
    try {
      const book =
        effective ??
        upsertBook({
          isbn13: createIsbn, isbn10: null, title: `ISBN ${createIsbn}`, subtitle: null, authors: [], publisher: null,
          publishedYear: null, edition: null, genres: [], pageCount: null, coverUrl: null, description: null, workKey: null, source: 'manual',
        });
      const catalog = getCatalogBook(book.id) ?? book;
      if (cover.kind === 'pick') {
        try {
          await setBookCover(book.id, cover.uri);
        } catch {
          setPhotoError("Couldn't save that photo. Try another one, or save without it.");
          setCover({ kind: 'none' });
          return;
        }
      } else if (cover.kind === 'remove') {
        removeBookCover(book.id);
      }
      saveBookEdit(book.id, toEditPatch(form, catalog));
      if (createIsbn) addUserBook(book.id, 'owned', params.room || undefined);
      invalidateLibrary(qc);
      router.back();
    } catch {
      setSaveError("Couldn't save your changes. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const reset = () => {
    if (!effective) return;
    Alert.alert('Reset to catalog?', 'Your changes and cover photo for this book will be removed.', [
      { text: 'Keep my changes', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => { resetBookEdits(effective.id); invalidateLibrary(qc); router.back(); } },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 15, color: c.text }}>Cancel</Text>
          </Pressable>
          <Text accessibilityRole="header" style={{ fontFamily: font.black, fontSize: 16, color: c.text }}>
            {createIsbn ? 'Add details' : 'Edit details'}
          </Text>
          <View style={{ width: 52 }} />
        </View>
        {notFound ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 15, color: c.soft, textAlign: 'center' }}>Couldn't find that book.</Text>
          </View>
        ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <CoverSlot
            id={effective?.id ?? isbn}
            title={form.title}
            coverUri={shownCover}
            onPick={(uri) => setCover({ kind: 'pick', uri })}
            onRemove={() => setCover({ kind: 'remove' })}
          />
          {photoError ? <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.tomato, textAlign: 'center', marginTop: 8 }}>{photoError}</Text> : null}

          <Field label="Title" value={form.title} onChange={set('title')} autoFocus={!form.title} />
          <Field label="Authors (separate with commas)" value={form.authors} onChange={set('authors')} />

          <Pressable onPress={() => setMore((m) => !m)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', marginTop: 8 }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.text, textDecorationLine: 'underline' }}>{showMore ? 'Fewer details' : 'More details'}</Text>
          </Pressable>
          {showMore ? (
            <>
              <Field label="Subtitle" value={form.subtitle} onChange={set('subtitle')} />
              <Field label="Publisher" value={form.publisher} onChange={set('publisher')} />
              <Field label="Year" value={form.year} onChange={set('year')} keyboardType="number-pad" error={yearError(form.year)} />
              <Field label="Edition" value={form.edition} onChange={set('edition')} />
            </>
          ) : null}

          <Text style={{ fontFamily: font.bold, fontSize: 13, color: c.soft, marginTop: 16 }}>{`ISBN ${isbn}`}</Text>

          <View style={{ marginTop: 20 }}>
            <Button label={createIsbn ? 'Save and shelve it' : 'Save'} onPress={save} disabled={!canSave(form) || busy} />
          </View>
          {saveError ? <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.tomato, textAlign: 'center', marginTop: 8 }}>{saveError}</Text> : null}
          {hasEdits ? (
            <Pressable onPress={reset} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
              <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: ink.tomato, textDecorationLine: 'underline' }}>Reset to catalog</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
