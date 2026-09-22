import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { listExportRows } from '@/db/repository';
import { exportFileName, libraryCsv } from './libraryCsv';

/** Works offline: built from the local database and handed to the share sheet. */
export async function shareLibraryCsv(now: Date = new Date()): Promise<void> {
  const file = new File(Paths.cache, exportFileName(now));
  if (file.exists) file.delete();
  file.create();
  file.write(libraryCsv(listExportRows()));
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Export my library' });
}

export const EXPORT_FAILED = "Couldn't make the export. Try again.";

/** The Export button's handler on Profile and Delete account: share the CSV, or say it didn't work. */
export function exportLibraryWithToast(showToast: (message: string) => void): void {
  shareLibraryCsv().catch(() => showToast(EXPORT_FAILED));
}
