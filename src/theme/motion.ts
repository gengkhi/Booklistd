import { Easing } from 'react-native-reanimated';

export const motion = { feedback: 120, routine: 220, overlay: 450, focal: 600 } as const;
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
/** Dewey's pop and the sticker slap — the only bouncy motions in the app. */
export const popSpring = { damping: 9, stiffness: 180, mass: 0.7 } as const;
