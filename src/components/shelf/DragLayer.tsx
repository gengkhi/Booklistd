/**
 * Drag a spine to another shelf or onto the bin. Zones (shelves + bin) register their window rects;
 * a long-press Pan on each spine moves a ghost on the UI thread and hit-tests with dropTarget.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { LibraryRow } from '@/lib/types';
import { dropTarget, type DropZone } from '@/features/shelves/dropTarget';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';
import { Spine } from './Spine';

const HOLD_MS = 400;
const EDGE = 80;
/** The bin's footprint from the provider's bottom (bottom 24 + height 64); the down-scroll band sits above it. */
const BIN_CLEAR = 88;

interface Ctx {
  draggingId: string | null;
  tick: number;
  zones: SharedValue<DropZone[]>;
  target: SharedValue<string>;
  x: SharedValue<number>;
  y: SharedValue<number>;
  edge: SharedValue<number>;
  bounds: SharedValue<{ top: number; bottom: number }>;
  register: (z: DropZone) => void;
  unregister: (key: string) => void;
  begin: (rowId: string) => void;
  targetChanged: (key: string) => void;
  setEdge: (dir: number) => void;
  drop: (key: string) => void;
  cancel: () => void;
  remeasure: () => void;
}

const DragCtx = createContext<Ctx | null>(null);

export const useDraggingId = () => useContext(DragCtx)?.draggingId ?? null;
export const useDragRemeasure = () => useContext(DragCtx)?.remeasure ?? (() => {});

/** Registers a view as a drop zone; highlight is 1 while the finger is over it. */
export function useDropZone(key: string, id: string | null, kind: 'shelf' | 'bin') {
  const ctx = useContext(DragCtx);
  const ref = useRef<View>(null);
  const measure = useCallback(() => {
    if (!ctx) return;
    ref.current?.measureInWindow((x, y, width, height) => ctx.register({ key, id, kind, rect: { x, y, width, height } }));
  }, [ctx?.register, key, id, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { measure(); }, [measure, ctx?.tick]);
  useEffect(() => () => ctx?.unregister(key), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = ctx?.target;
  const highlight = useAnimatedStyle(() => ({ opacity: target && target.value === key ? 1 : 0 }));
  return { ref, onLayout: ctx ? measure : undefined, highlightStyle: highlight };
}

export function DraggableSpine({ rowId, children }: { rowId: string; children: React.ReactNode }) {
  const ctx = useContext(DragCtx);
  // Every captured value is a shared value or a stable JS callback, so the gesture is rebuilt only if those change.
  const pan = useMemo(() => {
    if (!ctx) return null;
    const { zones, target, x, y, edge, bounds, begin, targetChanged, setEdge, drop, cancel } = ctx;
    return Gesture.Pan()
      .activateAfterLongPress(HOLD_MS)
      .onStart((e) => {
        x.value = e.absoluteX;
        y.value = e.absoluteY;
        target.value = '';
        runOnJS(begin)(rowId);
      })
      .onUpdate((e) => {
        x.value = e.absoluteX;
        y.value = e.absoluteY;
        const z = dropTarget({ x: e.absoluteX, y: e.absoluteY }, zones.value);
        const key = z ? z.key : '';
        if (key !== target.value) {
          target.value = key;
          runOnJS(targetChanged)(key);
        }
        const b = bounds.value;
        let dir = e.absoluteY < b.top + EDGE ? -1 : e.absoluteY > b.bottom - BIN_CLEAR - EDGE ? 1 : 0;
        if (target.value === 'bin') dir = 0; // hovering the bin never scrolls the bookcase
        if (dir !== edge.value) {
          edge.value = dir;
          runOnJS(setEdge)(dir);
        }
      })
      .onEnd((_e, success) => {
        if (success) runOnJS(drop)(target.value);
      })
      .onFinalize((_e, success) => {
        if (!success) runOnJS(cancel)();
      });
  }, [rowId, ctx?.zones, ctx?.target, ctx?.x, ctx?.y, ctx?.edge, ctx?.bounds, ctx?.begin, ctx?.targetChanged, ctx?.setEdge, ctx?.drop, ctx?.cancel]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pan) return <>{children}</>;
  return <GestureDetector gesture={pan}>{children}</GestureDetector>;
}

function Ghost({ row, x, y, origin }: { row: LibraryRow; x: SharedValue<number>; y: SharedValue<number>; origin: { x: number; y: number } }) {
  const reduced = useReducedMotion();
  const ox = origin.x;
  const oy = origin.y;
  const style = useAnimatedStyle(() => ({
    position: 'absolute', left: x.value - ox - 18, top: y.value - oy - 60,
    transform: reduced ? [] : [{ rotate: '-6deg' }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[style, { shadowColor: ink.brown, shadowOffset: { width: 5, height: 5 }, shadowOpacity: 1, shadowRadius: 0 }]}>
      <Spine id={row.id} title={row.book.title} />
    </Animated.View>
  );
}

function Bin({ target }: { target: SharedValue<string> }) {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  const zone = useDropZone('bin', null, 'bin');
  const rise = useSharedValue(reduced ? 0 : 80);
  useEffect(() => { if (!reduced) rise.value = withSpring(0, { damping: 16 }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => {
    const over = target.value === 'bin';
    return {
      transform: [{ translateY: rise.value }, { scale: reduced ? 1 : withTiming(over ? 1.15 : 1, { duration: 120 }) }],
      backgroundColor: over ? '#B8321D' : ink.tomato,
    };
  });
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center' }}>
      {/* Measured on a static box so the zone is the resting rect, not a frame of the rise. */}
      <View ref={zone.ref} onLayout={zone.onLayout} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={{ width: 140, height: 64 }}>
        <Animated.View
          style={[{ width: 140, height: 64, borderRadius: 16, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }, style]}>
          <Text style={{ fontFamily: font.black, fontSize: 15, color: ink.white }}>🗑 Remove</Text>
        </Animated.View>
      </View>
    </View>
  );
}

export function DragProvider({ rowsById, onDrop, onDraggingChange, onEdge, remeasureKey, children }: {
  rowsById: Map<string, LibraryRow>;
  /** Bump after the bookcase scrolls so zones re-measure. */
  remeasureKey?: number;
  onDrop: (row: LibraryRow, zone: DropZone) => void;
  onDraggingChange?: (dragging: boolean) => void;
  onEdge?: (dir: -1 | 0 | 1) => void;
  children: React.ReactNode;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const dragging = useRef<string | null>(null);
  const zoneMap = useRef(new Map<string, DropZone>());
  const root = useRef<View>(null);
  const zones = useSharedValue<DropZone[]>([]);
  const target = useSharedValue('');
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const edge = useSharedValue(0);
  const bounds = useSharedValue({ top: 0, bottom: 0 });
  const active = useSharedValue(false);
  // Latest props in a ref so the callbacks below (captured by every spine's gesture) stay stable across renders.
  const props = useRef({ rowsById, onDrop, onDraggingChange, onEdge });
  props.current = { rowsById, onDrop, onDraggingChange, onEdge };

  const register = useCallback((z: DropZone) => {
    zoneMap.current.set(z.key, z);
    zones.value = [...zoneMap.current.values()];
  }, [zones]);
  const unregister = useCallback((key: string) => {
    zoneMap.current.delete(key);
    zones.value = [...zoneMap.current.values()];
  }, [zones]);
  const remeasure = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => { remeasure(); }, [remeasureKey, remeasure]);

  const finish = useCallback(() => {
    dragging.current = null;
    setDraggingId(null);
    active.value = false;
    target.value = '';
    edge.value = 0;
    props.current.onEdge?.(0);
    props.current.onDraggingChange?.(false);
  }, [active, edge, target]);

  const begin = useCallback((rowId: string) => {
    dragging.current = rowId;
    setDraggingId(rowId);
    active.value = true;
    props.current.onDraggingChange?.(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    remeasure();
  }, [active, remeasure]);

  const targetChanged = useCallback((key: string) => { if (key) Haptics.selectionAsync(); }, []);

  // Zones move under a still finger while the bookcase auto-scrolls, so re-hit-test when they re-measure too.
  // onUpdate sets target first for finger moves; the key check here keeps targetChanged to once per change.
  useAnimatedReaction(
    () => (active.value ? dropTarget({ x: x.value, y: y.value }, zones.value)?.key ?? '' : null),
    (key) => {
      if (key === null || key === target.value) return;
      target.value = key;
      runOnJS(targetChanged)(key);
    }
  );
  const setEdge = useCallback((dir: number) => props.current.onEdge?.(dir as -1 | 0 | 1), []);

  const drop = useCallback((key: string) => {
    const row = dragging.current ? props.current.rowsById.get(dragging.current) : undefined;
    const zone = key ? zoneMap.current.get(key) : undefined;
    finish();
    if (!row || !zone) return;
    if (zone.kind === 'shelf' && zone.id === (row.shelfId ?? null)) return;
    props.current.onDrop(row, zone);
  }, [finish]);

  const cancel = useCallback(() => { if (dragging.current) finish(); }, [finish]);

  const measureRoot = useCallback(() => {
    root.current?.measureInWindow((rx, ry, _w, h) => {
      setOrigin({ x: rx, y: ry });
      bounds.value = { top: ry, bottom: ry + h };
    });
  }, [bounds]);

  const value = useMemo<Ctx>(() => ({
    draggingId, tick, zones, target, x, y, edge, bounds, register, unregister, begin, targetChanged, setEdge, drop, cancel, remeasure,
  }), [draggingId, tick, zones, target, x, y, edge, bounds, register, unregister, begin, targetChanged, setEdge, drop, cancel, remeasure]);

  const row = draggingId ? rowsById.get(draggingId) : undefined;
  return (
    <View ref={root} onLayout={measureRoot} style={{ flex: 1 }}>
      <DragCtx.Provider value={value}>
        {children}
        {row ? (
          <>
            <Bin target={target} />
            <Ghost row={row} x={x} y={y} origin={origin} />
          </>
        ) : null}
      </DragCtx.Provider>
    </View>
  );
}
