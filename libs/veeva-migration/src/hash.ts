/**
 * Canonical JSON + sha256 (§2.3 `source_hash`, §7.1 `mapping_hash`, run `config_hash`).
 * Keys sorted recursively, `null`/`undefined` values removed, arrays kept in order.
 */
import { createHash } from "node:crypto";

export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value))
    return value.map((v) =>
      v === undefined || v === null ? null : canonicalize(v),
    );
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = canonicalize((value as Record<string, unknown>)[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  if (typeof value === "function") return undefined;
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value) ?? null);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashObject(value: unknown): string {
  return sha256(canonicalJson(value));
}

/** 32-bit FNV-1a of a string, for `sum(hash32(source_hash))` aggregates (§2.8). */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
