import * as Haptics from 'expo-haptics';
import type { Haptic } from './reactions';

export function fireHaptic(h: Haptic): void {
  const S = Haptics.ImpactFeedbackStyle;
  if (h === 'light') Haptics.impactAsync(S.Light);
  else if (h === 'medium') Haptics.impactAsync(S.Medium);
  else {
    Haptics.impactAsync(S.Heavy);
    if (h === 'heavySuccess') setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 160);
  }
}
