import React, { useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { font, ink, radius } from '@/theme/palette';

/** "+ New shelf" name prompt: native Alert.prompt on iOS, a tiny modal elsewhere. Render `element` once. */
export function useShelfNamePrompt() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const cb = useRef<(name: string) => void>(() => {});

  const ask = (onName: (name: string) => void) => {
    cb.current = onName;
    if (Platform.OS === 'ios') {
      Alert.prompt('New shelf', 'What should we call it?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add', onPress: (v?: string) => { if (v?.trim()) onName(v); } },
      ], 'plain-text');
    } else {
      setDraft('');
      setOpen(true);
    }
  };

  const submit = () => {
    const v = draft.trim();
    setOpen(false);
    if (v) cb.current(v);
  };

  const element = Platform.OS === 'ios' ? null : (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable style={{ flex: 1, backgroundColor: '#0006', justifyContent: 'center', padding: 24 }} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Cancel">
        <Pressable onPress={() => {}} style={{ backgroundColor: ink.paper, borderWidth: 2.5, borderColor: ink.brown, borderRadius: radius.card, padding: 16 }}>
          <Text style={{ fontFamily: font.black, fontSize: 16, color: ink.brown }}>New shelf</Text>
          <TextInput value={draft} onChangeText={setDraft} autoFocus placeholder="What should we call it?" placeholderTextColor={ink.soft}
            onSubmitEditing={submit} accessibilityLabel="Shelf name"
            style={{ marginTop: 10, minHeight: 44, borderWidth: 2, borderColor: ink.brown, borderRadius: radius.card, paddingHorizontal: 10, fontFamily: font.bold, fontSize: 16, color: ink.brown, backgroundColor: ink.white }} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 12 }}>
            <Pressable onPress={() => setOpen(false)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.heavy, fontSize: 14, color: ink.brown }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.black, fontSize: 14, color: ink.brown }}>Add</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );

  return { ask, element };
}
