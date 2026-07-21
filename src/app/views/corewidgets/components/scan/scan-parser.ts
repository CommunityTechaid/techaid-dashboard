/**
 * Barcode-scan parsing for the device prep-mode prototype.
 *
 * Barcode scanners are keyboard-wedge devices: they "type" the barcode characters
 * followed by Enter. There is no hardware API. A focused input collects the
 * characters and hands the raw string here on Enter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ FORMAT ASSUMPTION — pending label-printing verification.
 *
 * The exact barcode payload is UNCONFIRMED (label printing does not live in this
 * repo). Everything below is an ASSUMPTION and is intentionally kept in this one
 * file so it can be corrected in a single place once real labels are seen:
 *
 *   - A scan matching KIT_ID_NUMERIC (/^\d+$/) or KIT_ID_PREFIXED (/^CTA-?(\d+)$/i)
 *     is treated as a KIT ID; the numeric id is extracted.
 *   - A scan starting with ACTION_PREFIX ("CTA*", e.g. "CTA*COMPLETE", "CTA*SKIP")
 *     is treated as an ACTION CODE; the code is normalised to upper-case with the
 *     prefix stripped.
 *   - Anything else is UNKNOWN (surfaced to the operator so mis-scans are visible).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Prefix that marks an action-code scan (as opposed to a kit-id scan). */
export const ACTION_PREFIX = 'CTA*';

/** A bare numeric barcode, e.g. "1234" → kit id 1234. */
export const KIT_ID_NUMERIC = /^\d+$/;

/** A "CTA"-prefixed kit barcode, e.g. "CTA-1234" / "CTA1234" → kit id 1234. */
export const KIT_ID_PREFIXED = /^CTA-?(\d+)$/i;

/** A recognised kit barcode: the numeric kit id was extracted. */
export interface KitIdScan {
  kind: 'kit-id';
  id: number;
  raw: string;
}

/** A recognised action barcode: `code` is upper-cased, prefix stripped. */
export interface ActionScan {
  kind: 'action';
  code: string;
  raw: string;
}

/** A scan that matched no known pattern — shown so operators catch mis-scans. */
export interface UnknownScan {
  kind: 'unknown';
  raw: string;
}

/** Discriminated union of every parse outcome. */
export type ScanEvent = KitIdScan | ActionScan | UnknownScan;

/**
 * Parse a raw scan string into a {@link ScanEvent}. Pure — no side effects.
 * `raw` is preserved verbatim on every result; only the trimmed value is matched.
 */
export function parseScan(raw: string): ScanEvent {
  const value = raw.trim();

  if (value.toUpperCase().startsWith(ACTION_PREFIX)) {
    const code = value.slice(ACTION_PREFIX.length).trim().toUpperCase();
    return code ? { kind: 'action', code, raw } : { kind: 'unknown', raw };
  }

  if (KIT_ID_NUMERIC.test(value)) {
    return { kind: 'kit-id', id: Number(value), raw };
  }

  const prefixed = KIT_ID_PREFIXED.exec(value);
  if (prefixed) {
    return { kind: 'kit-id', id: Number(prefixed[1]), raw };
  }

  return { kind: 'unknown', raw };
}
