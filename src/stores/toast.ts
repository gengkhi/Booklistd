import { AccessibilityInfo } from 'react-native';
import { create } from 'zustand';

export const TOAST_MS = 5000;
/** VoiceOver/TalkBack users need time to swipe to Undo. */
export const TOAST_MS_SCREEN_READER = 15000;

interface ToastState {
  message: string | null;
  onUndo: (() => void) | null;
  show: (message: string, onUndo?: () => void) => void;
  undo: () => void;
  dismiss: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
const clearTimer = () => {
  if (timer) clearTimeout(timer);
  timer = null;
};

let screenReaderOn = false;
try {
  AccessibilityInfo.isScreenReaderEnabled().then((on) => { screenReaderOn = on; }, () => {});
  AccessibilityInfo.addEventListener('screenReaderChanged', (on) => { screenReaderOn = on; });
} catch {
  // No native AccessibilityInfo (e.g. tests) — assume no screen reader.
}
export const __setScreenReaderForTest = (on: boolean) => { screenReaderOn = on; };

/** One app-wide toast. A new one replaces the old; its Undo is dropped (that action stays done). */
export const useToast = create<ToastState>((set, get) => ({
  message: null,
  onUndo: null,
  show: (message, onUndo) => {
    clearTimer();
    set({ message, onUndo: onUndo ?? null });
    AccessibilityInfo.announceForAccessibility?.(message + (onUndo ? ' Undo available.' : ''));
    timer = setTimeout(() => set({ message: null, onUndo: null }), screenReaderOn ? TOAST_MS_SCREEN_READER : TOAST_MS);
  },
  undo: () => {
    const cb = get().onUndo;
    if (!cb) return;
    clearTimer();
    set({ message: null, onUndo: null });
    cb();
  },
  dismiss: () => {
    clearTimer();
    set({ message: null, onUndo: null });
  },
}));
