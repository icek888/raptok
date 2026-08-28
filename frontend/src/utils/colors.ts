/**
 * ASS ↔ CSS color conversion utilities.
 * ASS format: &H00BBGGRR (00 = opaque alpha prefix, then Blue Green Red in hex)
 * CSS format: #RRGGBB
 */

/** Convert ASS color (&H00BBGGRR or &HBBGGRR) to CSS hex (#RRGGBB) */
export function assToCss(assColor: string): string {
  let hex = assColor.replace('&H', '').replace(/[^0-9A-Fa-f]/g, '');
  // Strip alpha prefix if 8 digits (00BBGGRR → BBGGRR)
  if (hex.length === 8) hex = hex.substring(2);
  if (hex.length >= 6) {
    const b = hex.substring(0, 2);
    const g = hex.substring(2, 4);
    const r = hex.substring(4, 6);
    return `#${r}${g}${b}`;
  }
  return '#FFFFFF';
}

/** Convert CSS hex (#RRGGBB) to ASS color (&H00BBGGRR) */
export function cssToAss(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length === 6) {
    const r = clean.substring(0, 2);
    const g = clean.substring(2, 4);
    const b = clean.substring(4, 6);
    return `&H00${b}${g}${r}`;
  }
  return '&H00FFFFFF';
}