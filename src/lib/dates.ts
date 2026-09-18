const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function greeting(date: Date, lamp: boolean): string {
  const h = date.getHours();
  if (lamp && (h >= 22 || h < 5)) return 'Still up?';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** SQLite datetime('now') strings: "YYYY-MM-DD HH:MM:SS". */
export function wantedSince(iso: string, now: Date): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return 'WANTED';
  return d.getFullYear() === now.getFullYear() ? `WANTED SINCE ${MONTHS[d.getMonth()]}` : `WANTED SINCE ${d.getFullYear()}`;
}
