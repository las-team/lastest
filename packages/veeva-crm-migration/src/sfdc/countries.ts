/**
 * Country helpers for the extractor. The table itself lives in
 * `model/countries.ts` (one source of truth for the whole package); this
 * module adds the loose parsing Salesforce `User.Country` values need
 * ("Germany (DE)", "DE - Germany", "Deutschland", diacritics).
 */
import {
  countryName as modelCountryName,
  KNOWN_COUNTRY_CODES,
  normalizeCountry as modelNormalizeCountry,
} from "../model/countries";
import type { CountryCode } from "../model/types";

const KNOWN = new Set(KNOWN_COUNTRY_CODES);

/** `true` when `code` is a known ISO-3166-1 alpha-2 code. */
export function isCountryCode(code: string): boolean {
  return KNOWN.has(code);
}

/** English short name for a code, or the code itself when unknown. */
export function countryName(code: CountryCode): string {
  return modelCountryName(code);
}

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Normalises a raw country value (ISO code in any case, alpha-3, English or
 * native name, common alias, decorated forms such as "Germany (DE)" or
 * "DE - Germany") to an upper-case alpha-2 code. Returns `null` when the
 * value is empty or not recognised.
 */
export function normalizeCountry(
  raw: string | null | undefined,
): CountryCode | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const direct =
    modelNormalizeCountry(trimmed) ??
    modelNormalizeCountry(stripDiacritics(trimmed));
  if (direct) return direct;
  const upper = trimmed.toUpperCase();
  // "Germany (DE)" / "DE - Germany" style values
  const paren = upper.match(/\(([A-Z]{2})\)/);
  if (paren?.[1] && isCountryCode(paren[1])) return paren[1];
  const prefix = upper.match(/^([A-Z]{2})\s*[-–:]/);
  if (prefix?.[1] && isCountryCode(prefix[1])) return prefix[1];
  return null;
}
