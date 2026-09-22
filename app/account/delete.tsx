import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useSession } from '@/auth/session';
import { SignInCancelled } from '@/auth/signIn';
import { canConfirmDelete, DELETE_FAILED, deleteAccount, deleteNeedsSignIn } from '@/features/account/deleteAccount';
import { exportLibraryWithToast } from '@/features/export/shareCsv';
import { useToast } from '@/stores/toast';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function DeleteAccountScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const providers = useSession((s) => s.providers);
  const status = useSession((s) => s.status);
  const showToast = useToast((s) => s.show);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const exportNow = () => exportLibraryWithToast(showToast);
  const remove = async () => {
    if (!canConfirmDelete(typed) || busy) return;
    if (deleteNeedsSignIn(status)) {
      router.push('/welcome');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await deleteAccount({ hasApple: providers.includes('apple') });
      router.replace('/welcome');
    } catch (e) {
      if (!(e instanceof SignInCancelled)) setProblem(DELETE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10} style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.text }}>Cancel</Text>
          </Pressable>
          <ScreenHeader title="Delete account" />
          <View style={{ paddingHorizontal: 20, marginTop: 12, gap: 14 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 15, lineHeight: 21, color: c.text }}>
              Deleting your account removes your shelves, books, readings, loans and cover photos, on every device. This can't be undone.
            </Text>
            <Button label="Export my library" variant="ghost" disabled={busy} onPress={exportNow} />
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.text, marginTop: 8 }}>Type DELETE to confirm</Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Type DELETE to confirm"
              style={{
                minHeight: 46, paddingHorizontal: 12, borderWidth: 2, borderColor: c.line, borderRadius: radius.pill / 2,
                backgroundColor: ink.white, fontFamily: font.bold, fontSize: 16, color: ink.brown,
              }}
            />
            <Button label={busy ? 'Deleting…' : 'Delete my account'} variant="danger" disabled={busy || !canConfirmDelete(typed)} onPress={remove} />
            {problem ? <Text accessibilityRole="alert" style={{ fontFamily: font.bold, fontSize: 13, color: ink.tomato, textAlign: 'center' }}>{problem}</Text> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
