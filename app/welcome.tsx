import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Dewey } from '@/components/dewey/Dewey';
import { Button } from '@/components/ui/Button';
import { authErrorMessage } from '@/auth/authErrors';
import { isPlausibleEmail, resendLabel } from '@/auth/emailLink';
import { sendEmailLink, signInWithApple, signInWithGoogle } from '@/auth/signIn';
import { PRIVACY_POLICY_URL } from '@/lib/links';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

type Mode = 'buttons' | 'email' | 'sent';

export default function Welcome() {
  const { c, scheme } = useTheme();
  const [mode, setMode] = useState<Mode>('buttons');
  const [email, setEmail] = useState('');
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [appleReady, setAppleReady] = useState(false);

  // Apple's guidelines require the native button on iOS; Android hides Apple until web sign-in is configured.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAppleReady, () => setAppleReady(false));
  }, []);
  useEffect(() => {
    if (mode !== 'sent') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [mode]);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await task();
    } catch (e) {
      setProblem(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      await sendEmailLink(email);
      const t = Date.now();
      setSentAt(t);
      setNow(t);
      setMode('sent');
    });
  const resend = resendLabel(sentAt, now);
  const link = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10} style={{ alignSelf: 'center', paddingVertical: 6 }}>
      <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.text, textDecorationLine: 'underline' }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 32 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center' }}>
            <Dewey mood="happy" size={96} pop />
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 40, lineHeight: 44, color: c.text, marginTop: 12 }}>Booklistd</Text>
            <Text style={{ fontFamily: font.bold, fontSize: 15, color: c.soft, marginTop: 6, textAlign: 'center' }}>
              Your shelves, backed up and on every phone.
            </Text>
          </View>

          <View style={{ marginTop: 32, gap: 12 }}>
            {mode === 'buttons' ? (
              <>
                {appleReady ? (
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                    buttonStyle={scheme === 'lamp' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={radius.button}
                    style={{ height: 52 }}
                    onPress={() => run(() => signInWithApple())}
                  />
                ) : null}
                <Button label="Continue with Google" variant="ghost" disabled={busy} onPress={() => run(() => signInWithGoogle())} />
                <Button label="Email me a sign-in link" variant="ghost" disabled={busy} onPress={() => { setProblem(null); setMode('email'); }} />
              </>
            ) : null}

            {mode === 'email' ? (
              <>
                <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.text }}>Your email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="send"
                  onSubmitEditing={() => { if (isPlausibleEmail(email)) send(); }}
                  accessibilityLabel="Your email"
                  style={{
                    minHeight: 46, paddingHorizontal: 12, borderWidth: 2, borderColor: c.line, borderRadius: radius.pill / 2,
                    backgroundColor: ink.white, fontFamily: font.bold, fontSize: 16, color: ink.brown,
                  }}
                />
                <Button label={busy ? 'Sending…' : 'Send link'} disabled={busy || !isPlausibleEmail(email)} onPress={send} />
                {link('Back', () => { setProblem(null); setMode('buttons'); })}
              </>
            ) : null}

            {mode === 'sent' ? (
              <>
                <Text accessibilityRole="header" style={{ fontFamily: font.black, fontSize: 17, color: c.text, textAlign: 'center' }}>Check your inbox</Text>
                <Text style={{ fontFamily: font.bold, fontSize: 14, color: c.soft, textAlign: 'center' }}>
                  {`We sent a sign-in link to ${email.trim()}. It works once, within an hour.`}
                </Text>
                <Button label={resend.label} variant="ghost" disabled={busy || !resend.enabled} onPress={send} />
                {link('Use a different email', () => { setProblem(null); setMode('email'); })}
              </>
            ) : null}

            {problem ? (
              <Text accessibilityRole="alert" style={{ fontFamily: font.bold, fontSize: 13, color: ink.tomato, textAlign: 'center' }}>{problem}</Text>
            ) : null}
          </View>

          {PRIVACY_POLICY_URL ? <View style={{ marginTop: 28 }}>{link('Privacy policy', () => Linking.openURL(PRIVACY_POLICY_URL!))}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
