/**
 * Cover photos live in <documents>/covers/. The DB stores the path *relative* to the documents
 * directory, because the absolute container path changes across iOS reinstalls/updates.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const COVERS_DIR = 'covers';
const COVER_WIDTH = 600;

export function coverFileName(bookId: string, now: number = Date.now()): string {
  return `${COVERS_DIR}/${bookId.replace(/[^A-Za-z0-9-]/g, '_')}-${now}.jpg`;
}

export function resolveCoverUri(coverPath: string | null, documentUri: string): string | null {
  if (!coverPath) return null;
  return `${documentUri.endsWith('/') ? documentUri : `${documentUri}/`}${coverPath}`;
}

export function documentUri(): string {
  const u = Paths.document.uri;
  return u.endsWith('/') ? u : `${u}/`;
}

/** Resize to ~600px wide JPEG and copy into covers/. Returns the relative path. Throws on failure. */
export async function saveCoverFile(bookId: string, sourceUri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(sourceUri);
  ctx.resize({ width: COVER_WIDTH });
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const dir = new Directory(Paths.document, COVERS_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const rel = coverFileName(bookId);
  // File.copy() is async in SDK 57 (expo-file-system's new File/Directory API); copySync() keeps
  // this a plain synchronous step within the async function, matching create()/delete() above.
  new File(out.uri).copySync(new File(Paths.document, rel));
  return rel;
}

/** Best-effort: a missing file is fine. */
export function deleteCoverFile(coverPath: string | null): void {
  if (!coverPath) return;
  try {
    const f = new File(Paths.document, coverPath);
    if (f.exists) f.delete();
  } catch {
    // Leftover file costs a few KB; never block the user on it.
  }
}

/** Best-effort: removes every local cover photo (used by the account wipe). */
export function deleteAllCoverFiles(): void {
  try {
    const dir = new Directory(Paths.document, COVERS_DIR);
    if (dir.exists) dir.delete();
  } catch {
    // A leftover folder is harmless; the rows that pointed at it are gone.
  }
}

/** Best-effort: moves a cover photo to a name that uses the new book id. Returns the new relative path, or null. */
export function renameCoverFile(coverPath: string, bookId: string): string | null {
  try {
    const from = new File(Paths.document, coverPath);
    if (!from.exists) return null;
    const rel = coverFileName(bookId);
    from.moveSync(new File(Paths.document, rel));
    return rel;
  } catch {
    return null;
  }
}
