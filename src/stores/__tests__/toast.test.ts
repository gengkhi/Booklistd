import { AccessibilityInfo } from 'react-native';
import { TOAST_MS, TOAST_MS_SCREEN_READER, __setScreenReaderForTest, useToast } from '../toast';

beforeEach(() => {
  jest.useFakeTimers();
  useToast.getState().dismiss();
});
afterEach(() => {
  jest.useRealTimers();
  __setScreenReaderForTest(false);
});

describe('toast store', () => {
  it('shows a message and clears it after TOAST_MS', () => {
    useToast.getState().show('Moved to Study.');
    expect(useToast.getState().message).toBe('Moved to Study.');
    jest.advanceTimersByTime(TOAST_MS);
    expect(useToast.getState().message).toBeNull();
  });
  it('undo runs the callback once and clears', () => {
    const cb = jest.fn();
    useToast.getState().show('Removed from your shelves.', cb);
    useToast.getState().undo();
    useToast.getState().undo();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(useToast.getState().message).toBeNull();
  });
  it('a new toast replaces the pending one (its undo is dropped)', () => {
    const first = jest.fn();
    useToast.getState().show('Removed from your shelves.', first);
    useToast.getState().show('Moved to Study.');
    useToast.getState().undo();
    expect(first).not.toHaveBeenCalled();
    jest.advanceTimersByTime(TOAST_MS - 1);
    expect(useToast.getState().message).toBe('Moved to Study.');
  });
  it('undo without a callback leaves the toast and its timer alone', () => {
    useToast.getState().show('Moved to Study.');
    useToast.getState().undo();
    expect(useToast.getState().message).toBe('Moved to Study.');
    jest.advanceTimersByTime(TOAST_MS);
    expect(useToast.getState().message).toBeNull();
  });
  it('announces the toast, and says when Undo is available', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    useToast.getState().show('Removed from your shelves.', jest.fn());
    expect(announce).toHaveBeenLastCalledWith('Removed from your shelves. Undo available.');
    useToast.getState().show('Moved to Study.');
    expect(announce).toHaveBeenLastCalledWith('Moved to Study.');
    announce.mockRestore();
  });
  it('stays up longer while a screen reader is on', () => {
    __setScreenReaderForTest(true);
    useToast.getState().show('Removed from your shelves.', jest.fn());
    jest.advanceTimersByTime(TOAST_MS);
    expect(useToast.getState().message).toBe('Removed from your shelves.');
    jest.advanceTimersByTime(TOAST_MS_SCREEN_READER - TOAST_MS);
    expect(useToast.getState().message).toBeNull();
  });
});
