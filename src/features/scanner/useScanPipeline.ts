/**
 * The scan pipeline behind Store Mode. Camera-library-agnostic on purpose:
 * feed it raw barcode payloads from expo-camera today, VisionCamera later.
 * Handles: ISBN normalize -> per-code cooldown -> instant local verdict ->
 * background metadata fetch for unknown books.
 */
import { useCallback, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { normalizeToIsbn13 } from '@/lib/isbn';
import { checkOwnership, upsertBook } from '@/db/repository';
import { lookupIsbn, type BookMeta } from '@/api/bookLookup';
import type { OwnershipVerdict } from '@/lib/types';

const COOLDOWN_MS = 2500;

export interface ScanResult {
  isbn13: string;
  verdict: OwnershipVerdict;
  meta: BookMeta | null; // filled async for unknown books
  metaLoading: boolean;
}

export function useScanPipeline() {
  const cooldown = useRef<Map<string, number>>(new Map());
  const [current, setCurrent] = useState<ScanResult | null>(null);
  const [sessionCount, setSessionCount] = useState(0);

  const onBarcode = useCallback((raw: string) => {
    const isbn13 = normalizeToIsbn13(raw);
    if (!isbn13) return;

    const last = cooldown.current.get(isbn13) ?? 0;
    const now = Date.now();
    if (now - last < COOLDOWN_MS) return;
    cooldown.current.set(isbn13, now);

    const verdict = checkOwnership(isbn13);
    Haptics.notificationAsync(
      verdict.owned ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
    );
    setSessionCount((n) => n + 1);
    setCurrent({ isbn13, verdict, meta: null, metaLoading: !verdict.exactIsbnMatch });

    if (!verdict.exactIsbnMatch) {
      lookupIsbn(isbn13).then((meta) => {
        if (meta) {
          // Cache into local catalog, then re-check: workKey may reveal an owned edition.
          upsertBook(meta);
          const recheck = checkOwnership(isbn13, meta.workKey);
          setCurrent((c) =>
            c?.isbn13 === isbn13 ? { ...c, meta, metaLoading: false, verdict: recheck } : c
          );
        } else {
          setCurrent((c) => (c?.isbn13 === isbn13 ? { ...c, metaLoading: false } : c));
        }
      });
    }
  }, []);

  const dismiss = useCallback(() => setCurrent(null), []);
  return { current, sessionCount, onBarcode, dismiss };
}
