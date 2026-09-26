// The viewer's calendar day. toISOString() gives the UTC day, which near
// midnight is yesterday or tomorrow for most of the world - wrong for an
// "accessed" date in a citation or a download's filename.

/** A date as YYYY-MM-DD in the viewer's local time zone (default: now). */
export function localIsoDate(d: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
