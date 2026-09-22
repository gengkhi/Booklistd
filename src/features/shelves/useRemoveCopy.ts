import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { openLoanFor, removeCopyForUndo, restoreCopy } from '@/db/repository';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { useToast } from '@/stores/toast';

/** Remove a copy from your shelves (reading and rating stay), with Undo. Lent-out copies ask first. */
export function useRemoveCopy() {
  const qc = useQueryClient();
  const show = useToast((s) => s.show);
  return (copyId: string, opts?: { onRemoved?: () => void }) => {
    const go = () => {
      const undo = removeCopyForUndo(copyId);
      if (!undo) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      invalidateLibrary(qc);
      opts?.onRemoved?.();
      show('Removed from your shelves.', () => {
        restoreCopy(undo.copyId, undo.reopenLoanId);
        invalidateLibrary(qc);
      });
    };
    const loan = openLoanFor(copyId);
    if (!loan) return go();
    Alert.alert(`It's visiting ${loan.borrower}. Remove anyway?`, undefined, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: go },
    ]);
  };
}
