/**
 * ISBN utilities — the scan pipeline's first stop.
 *
 * The implementation lives in supabase/functions/_shared/bookCore.ts so the app and the
 * book-lookup edge function validate ISBNs and derive work keys with the very same code
 * (a mismatch there makes "you own another edition" matches go missing).
 */
export { fallbackWorkKey, normalizeToIsbn13, parseIsbnStrict } from '../../supabase/functions/_shared/bookCore';
