import type { ConfigContext, ExpoConfig } from 'expo/config';

const DEV_PLACEHOLDER_SCHEME = 'com.googleusercontent.apps.missing-EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME';

/**
 * The Google iOS URL scheme. A preview or production EAS build without it would ship a Google sign-in that
 * can never return to the app, so those fail here (H3); development builds and local runs keep a placeholder.
 */
function googleIosUrlScheme(): string {
  const scheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  if (scheme) return scheme;
  const profile = process.env.EAS_BUILD_PROFILE;
  if (profile && profile !== 'development') {
    throw new Error(`EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME is not set for the "${profile}" EAS build. Set it in the EAS environment.`);
  }
  return DEV_PLACEHOLDER_SCHEME;
}

/**
 * app.json plus the Google sign-in plugin. Its iOS URL scheme is the reversed iOS client id, which is
 * public but per-project. Set EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME in .env and in the EAS environment.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  plugins: [
    ...(config.plugins ?? []),
    ['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme() }],
  ],
});
