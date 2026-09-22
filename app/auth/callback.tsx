import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { authErrorMessage, callbackResult, GENERIC_SIGN_IN_ERROR } from '@/auth/authErrors';
import { completeEmailLink } from '@/auth/signIn';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** booklistd://auth/callback?code=… — the email link lands here (PKCE). */
export default function AuthCallback() {
  const { c } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; error?: string; error_code?: string }>();
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const r = callbackResult(params);
    if ('error' in r) {
      setProblem(r.error);
      return;
    }
    completeEmailLink(r.code).then(
      () => router.replace('/'),
      (e) => setProblem(authErrorMessage(e) ?? GENERIC_SIGN_IN_ERROR)
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper, justifyContent: 'center', paddingHorizontal: 20 }}>
      <View style={{ gap: 16 }}>
        <Text accessibilityRole={problem ? 'alert' : undefined} style={{ fontFamily: font.black, fontSize: 17, color: problem ? ink.tomato : c.text, textAlign: 'center' }}>
          {problem ?? 'Signing you in…'}
        </Text>
        {problem ? <Button label="Back to sign in" variant="ghost" onPress={() => router.replace('/welcome')} /> : null}
      </View>
    </SafeAreaView>
  );
}
