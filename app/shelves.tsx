import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import type { Plank, ShelfRow } from '@/lib/types';
import { createShelf, deleteShelf, listShelves, renameShelf, reorderShelves, setShelfPlank, ShelfNameTaken } from '@/db/repository';
import { MAX_SHELF_NAME, PLANK_INKS, plankColor, UNSHELVED } from '@/features/shelves/shelfRules';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { ReorderList } from '@/components/shelves/ReorderList';
import { useShelfNamePrompt } from '@/components/shelves/useShelfNamePrompt';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Raised } from '@/components/ui/Raised';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const ROW_H = 68;
const PLANK_NAMES: Record<Plank, string> = { bus: 'Yellow', tomato: 'Red', pool: 'Blue', grass: 'Green', plum: 'Purple' };

function EditSheet({ shelf, others, onClose, onChanged }: { shelf: ShelfRow; others: ShelfRow[]; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(shelf.name);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState<string | null>(null);

  const save = () => {
    try {
      renameShelf(shelf.id, name);
      setError(null);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof ShelfNameTaken ? e.message : e instanceof Error ? e.message : 'Give the shelf a name.');
    }
  };
  const recolour = (p: Plank) => {
    try {
      setShelfPlank(shelf.id, p);
      setError(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the colour.');
    }
  };
  const remove = () => {
    try {
      deleteShelf(shelf.id, moveTo);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the shelf.');
    }
  };
  const askDelete = () => {
    if (shelf.bookCount === 0) {
      Alert.alert(`Delete the ${shelf.name} shelf?`, undefined, [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: remove },
      ]);
    } else setDeleting(true);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: ink.paper, borderTopWidth: 2.5, borderColor: ink.brown, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: 20, paddingBottom: 36 }}>
          {deleting ? (
            <>
              <Text accessibilityRole="header" style={{ fontFamily: font.black, fontSize: 17, color: ink.brown }}>
                {`Delete the ${shelf.name} shelf? Move its ${shelf.bookCount} ${shelf.bookCount === 1 ? 'book' : 'books'} to:`}
              </Text>
              {error ? <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.tomato, marginTop: 4 }}>{error}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {others.map((o) => <Chip key={o.id} label={o.name} selected={moveTo === o.id} onPress={() => setMoveTo(o.id)} />)}
                <Chip label={UNSHELVED} selected={moveTo === null} onPress={() => setMoveTo(null)} />
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                <Button variant="ghost" flex label="Keep it" onPress={() => setDeleting(false)} />
                <Button flex label="Delete" onPress={remove} />
              </View>
            </>
          ) : (
            <>
              <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.brown }}>Name</Text>
              <TextInput value={name} onChangeText={(t) => { setName(t); setError(null); }} accessibilityLabel="Shelf name" onSubmitEditing={save} maxLength={MAX_SHELF_NAME}
                style={{ marginTop: 6, minHeight: 46, paddingHorizontal: 12, borderWidth: 2, borderColor: error ? ink.tomato : ink.brown, borderRadius: radius.card, backgroundColor: ink.white, fontFamily: font.bold, fontSize: 16, color: ink.brown }} />
              {error ? <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.tomato, marginTop: 4 }}>{error}</Text> : null}
              <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.brown, marginTop: 16 }}>Plank colour</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                {PLANK_INKS.map((p) => (
                  <Pressable key={p} onPress={() => recolour(p)} accessibilityRole="button" accessibilityLabel={`Plank colour ${PLANK_NAMES[p]}`} accessibilityState={{ selected: shelf.plank === p }}
                    style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: plankColor(p), borderWidth: shelf.plank === p ? 4 : 2, borderColor: ink.brown }} />
                ))}
              </View>
              <View style={{ marginTop: 18 }}><Button label="Save" onPress={save} /></View>
              <Pressable onPress={askDelete} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
                <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: ink.tomato, textDecorationLine: 'underline' }}>Delete shelf</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function ManageShelvesScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const { data: shelves = [] } = useQuery({ queryKey: ['shelves'], queryFn: () => listShelves() });
  const [editing, setEditing] = useState<ShelfRow | null>(null);
  const prompt = useShelfNamePrompt();
  const refresh = () => invalidateLibrary(qc);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
          <Raised offset={2} radius={22} style={{ alignSelf: 'flex-start' }}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={20} height={20} fill="none" stroke={ink.brown} strokeWidth={2.8}><Path d="M13 4l-7 6 7 6" /></Svg>
            </Pressable>
          </Raised>
        </View>
        <ScreenHeader title="Manage shelves" sub={shelves.length ? 'Hold a shelf to drag it. Tap to rename or recolour.' : 'No shelves yet. Add your first below.'} />
        <View style={{ marginHorizontal: 16, marginTop: 14 }}>
          <ReorderList
            key={shelves.map((s) => s.id).join()}
            items={shelves}
            rowHeight={ROW_H}
            onReorder={(ids) => { reorderShelves(ids); refresh(); }}
            renderRow={(s, _i, a11y) => (
              <Pressable {...a11y} onPress={() => setEditing(s)} accessibilityRole="button"
                accessibilityLabel={`${s.name}, ${s.bookCount} ${s.bookCount === 1 ? 'book' : 'books'}`}
                accessibilityHint="Double-tap to edit. Hold to drag, or use the Move up and Move down actions."
                style={{ height: ROW_H - 8, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ink.white, borderWidth: 2, borderColor: c.line, borderRadius: 12, paddingHorizontal: 12 }}>
                <View style={{ width: 28, height: 14, backgroundColor: plankColor(s.plank), borderWidth: 2, borderColor: ink.brown }} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{s.name}</Text>
                  <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.soft }}>{`${s.bookCount} ${s.bookCount === 1 ? 'book' : 'books'}`}</Text>
                </View>
                <Svg width={18} height={18} stroke={ink.soft} strokeWidth={2.4} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Path d="M3 6h12M3 12h12" /></Svg>
              </Pressable>
            )}
          />
          <View style={{ marginTop: 12 }}>
            <Button variant="ghost" label="+ New shelf" onPress={() => prompt.ask((n) => { createShelf(n); refresh(); })} />
          </View>
        </View>
      </ScrollView>
      {prompt.element}
      {editing ? (
        <EditSheet
          shelf={shelves.find((s) => s.id === editing.id) ?? editing}
          others={shelves.filter((s) => s.id !== editing.id)}
          onClose={() => setEditing(null)}
          onChanged={refresh}
        />
      ) : null}
    </SafeAreaView>
  );
}
