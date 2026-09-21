import React, { useCallback } from 'react';
import { View, type AccessibilityActionEvent, type AccessibilityActionInfo } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, type SharedValue,
} from 'react-native-reanimated';

type Positions = Record<string, number>;

/** Spread onto the row's focusable element so VoiceOver offers Move up / Move down on it. */
export type ReorderA11y = {
  accessibilityActions: AccessibilityActionInfo[];
  onAccessibilityAction: (e: AccessibilityActionEvent) => void;
};

const MOVE_ACTIONS: AccessibilityActionInfo[] = [{ name: 'moveUp', label: 'Move up' }, { name: 'moveDown', label: 'Move down' }];

function Row({ id, count, rowHeight, positions, onDrop, children }: {
  id: string; count: number; rowHeight: number; positions: SharedValue<Positions>;
  onDrop: () => void; children: React.ReactNode;
}) {
  const top = useSharedValue(positions.value[id] * rowHeight);
  const start = useSharedValue(0);
  const active = useSharedValue(false);

  useAnimatedReaction(
    () => positions.value[id],
    (cur, prev) => {
      if (cur !== prev && !active.value) top.value = withSpring(cur * rowHeight, { damping: 18, stiffness: 220 });
    }
  );

  const pan = Gesture.Pan()
    .activateAfterLongPress(250)
    .onStart(() => {
      active.value = true;
      start.value = top.value;
    })
    .onUpdate((e) => {
      top.value = start.value + e.translationY;
      const to = Math.min(count - 1, Math.max(0, Math.round(top.value / rowHeight)));
      const from = positions.value[id];
      if (to !== from) {
        const next: Positions = { ...positions.value };
        for (const k of Object.keys(next)) if (next[k] === to) next[k] = from;
        next[id] = to;
        positions.value = next;
      }
    })
    .onEnd(() => {
      top.value = withSpring(positions.value[id] * rowHeight, { damping: 18, stiffness: 220 });
      active.value = false;
      runOnJS(onDrop)();
    });

  const style = useAnimatedStyle(() => ({
    position: 'absolute', left: 0, right: 0, height: rowHeight, top: top.value,
    zIndex: active.value ? 10 : 0,
    transform: [{ scale: active.value ? 1.02 : 1 }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  );
}

/** Long-press a row to drag it; VoiceOver users get Move up / Move down actions. Fixed-height rows. */
export function ReorderList<T extends { id: string }>({ items, rowHeight, renderRow, onReorder }: {
  items: T[]; rowHeight: number; renderRow: (item: T, index: number, a11y: ReorderA11y) => React.ReactNode; onReorder: (ids: string[]) => void;
}) {
  const positions = useSharedValue<Positions>(Object.fromEntries(items.map((it, i) => [it.id, i])));

  const commit = useCallback(() => {
    const ids = Object.entries(positions.value).sort((a, b) => a[1] - b[1]).map(([id]) => id);
    if (ids.join() !== items.map((i) => i.id).join()) onReorder(ids);
  }, [items, onReorder, positions]);

  const move = useCallback((id: string, dir: -1 | 1) => {
    const ids = items.map((i) => i.id);
    const at = ids.indexOf(id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    onReorder(ids);
  }, [items, onReorder]);

  return (
    <View style={{ height: items.length * rowHeight }}>
      {items.map((it, i) => (
        <Row key={it.id} id={it.id} count={items.length} rowHeight={rowHeight} positions={positions} onDrop={commit}>
          {renderRow(it, i, {
            accessibilityActions: MOVE_ACTIONS,
            onAccessibilityAction: (e) => {
              const name = e.nativeEvent.actionName;
              if (name === 'moveUp' || name === 'moveDown') move(it.id, name === 'moveUp' ? -1 : 1);
            },
          })}
        </Row>
      ))}
    </View>
  );
}
