/**
 * Canonical serialization of a coverage cell's coordinates.
 *
 * The DB unique index is on `coordsKey`, so the encoding must be stable
 * regardless of key insertion order and must not collide for values that
 * contain the separator characters.
 */

const FIELD_SEP = "|";
const KV_SEP = "=";

function escapePart(part: string): string {
  return part.replace(/\\/g, "\\\\").replace(/\|/g, "\\p").replace(/=/g, "\\e");
}

function unescapePart(part: string): string {
  return part.replace(/\\p/g, "|").replace(/\\e/g, "=").replace(/\\\\/g, "\\");
}

/** Field-sorted `field=value|field=value`. Empty coords → empty string. */
export function coordsKey(coords: Record<string, string>): string {
  return Object.keys(coords)
    .sort()
    .map((f) => `${escapePart(f)}${KV_SEP}${escapePart(coords[f] ?? "")}`)
    .join(FIELD_SEP);
}

export function parseCoordsKey(key: string): Record<string, string> {
  if (!key) return {};
  const out: Record<string, string> = {};
  for (const pair of key.split(FIELD_SEP)) {
    const idx = pair.indexOf(KV_SEP);
    if (idx === -1) continue;
    out[unescapePart(pair.slice(0, idx))] = unescapePart(pair.slice(idx + 1));
  }
  return out;
}

/** Project coords onto a subset of fields. Fields absent from `coords` are
 *  dropped, so the result may be narrower than `fields`. */
export function projectCoords(
  coords: Record<string, string>,
  fields: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (coords[f] !== undefined) out[f] = coords[f];
  }
  return out;
}
