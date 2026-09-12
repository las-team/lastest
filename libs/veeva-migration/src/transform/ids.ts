/**
 * Salesforce id helpers (§2.4): 15-char case-sensitive ids are normalised to
 * the 18-char case-safe form before keying anything.
 */

const SUFFIX_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";

/** Compute the 3-char checksum suffix of a 15-char Salesforce id. */
export function idChecksum(id15: string): string {
  let out = "";
  for (let block = 0; block < 3; block++) {
    let bits = 0;
    for (let i = 0; i < 5; i++) {
      const ch = id15[block * 5 + i];
      if (ch >= "A" && ch <= "Z") bits |= 1 << i;
    }
    out += SUFFIX_CHARS[bits];
  }
  return out;
}

/** Is `value` shaped like a Salesforce id (15 or 18 alphanumerics)? */
export function isSfdcId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(value)
  );
}

/**
 * Normalise a 15- or 18-char id to the 18-char case-safe form. An 18-char
 * input is returned with its suffix recomputed (so a mis-cased suffix from a
 * CSV is repaired). Throws on anything else.
 */
export function to18(id: string): string {
  const v = id.trim();
  if (!isSfdcId(v)) throw new Error(`Not a Salesforce id: "${id}"`);
  return v.slice(0, 15) + idChecksum(v.slice(0, 15));
}

/** 15-char case-sensitive form. */
export function to15(id: string): string {
  const v = id.trim();
  if (!isSfdcId(v)) throw new Error(`Not a Salesforce id: "${id}"`);
  return v.slice(0, 15);
}

/** Key prefix (`001` Account, `005` User, `00G` Group/queue, `003` Contact). */
export function keyPrefix(id: string): string {
  return id.slice(0, 3);
}

export const PREFIX_USER = "005";
export const PREFIX_GROUP = "00G";
export const PREFIX_CONTACT = "003";
export const PREFIX_ACCOUNT = "001";

export function isUserId(id: unknown): boolean {
  return isSfdcId(id) && keyPrefix(id) === PREFIX_USER;
}
export function isQueueId(id: unknown): boolean {
  return isSfdcId(id) && keyPrefix(id) === PREFIX_GROUP;
}
export function isContactId(id: unknown): boolean {
  return isSfdcId(id) && keyPrefix(id) === PREFIX_CONTACT;
}

/** Render the stored legacy-id value per `legacyId.format` (§3.2). */
export function formatLegacyId(
  id: string,
  format: string,
  orgId15?: string,
): string {
  const id18 = to18(id);
  return format
    .replace("{id18}", id18)
    .replace("{id15}", id18.slice(0, 15))
    .replace("{orgId15}", orgId15 ?? "");
}
