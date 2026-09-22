import appJson from '../../../app.json';
import makeConfig from '../../../app.config';

type Plugin = string | [string, Record<string, unknown>];
const base = { config: appJson.expo } as never;

describe('app config', () => {
  it('turns on Sign in with Apple and keeps the booklistd scheme for the email link', () => {
    const cfg = makeConfig(base);
    expect(cfg.ios?.usesAppleSignIn).toBe(true);
    expect(cfg.scheme).toBe('booklistd');
  });

  it('adds the secure-store, Apple and Google plugins', () => {
    process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME = 'com.googleusercontent.apps.123-abc';
    const plugins = makeConfig(base).plugins as Plugin[];
    const names = plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toEqual(expect.arrayContaining(['expo-secure-store', 'expo-apple-authentication', '@react-native-google-signin/google-signin']));
    const google = plugins.find((p) => Array.isArray(p) && p[0] === '@react-native-google-signin/google-signin') as [string, { iosUrlScheme: string }];
    expect(google[1].iosUrlScheme).toBe('com.googleusercontent.apps.123-abc');
  });

  describe('the Google iOS URL scheme outside development builds (H3)', () => {
    const saved = { scheme: process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME, profile: process.env.EAS_BUILD_PROFILE };
    const restore = (k: string, v: string | undefined) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    };
    afterEach(() => {
      restore('EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME', saved.scheme);
      restore('EAS_BUILD_PROFILE', saved.profile);
    });
    const googleScheme = () => {
      const plugins = makeConfig(base).plugins as Plugin[];
      return (plugins.find((p) => Array.isArray(p) && p[0] === '@react-native-google-signin/google-signin') as [string, { iosUrlScheme: string }])[1].iosUrlScheme;
    };

    it.each(['preview', 'production'])('a %s build without it fails loudly', (profile) => {
      delete process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
      process.env.EAS_BUILD_PROFILE = profile;
      expect(() => makeConfig(base)).toThrow(/EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME/);
    });

    it('a development build or a local run keeps the placeholder', () => {
      delete process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
      process.env.EAS_BUILD_PROFILE = 'development';
      expect(googleScheme()).toMatch(/missing-EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME/);
      delete process.env.EAS_BUILD_PROFILE;
      expect(googleScheme()).toMatch(/missing-EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME/);
    });
  });
});
