/** UUID-ish, good enough locally; the server keeps it as-is on sync. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
