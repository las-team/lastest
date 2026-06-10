import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error("ENCRYPTION_KEY env var is not set");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32)
    throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  return key;
}

export function encrypt(text: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decrypt(value: string): string {
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext passthrough
  const key = getKey();
  return decryptWithKey(value, key);
}

export function decryptWithKey(value: string, key: Buffer): string {
  if (!value.startsWith(PREFIX)) return value;
  const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split(":");
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return (
    decipher.update(Buffer.from(ctB64, "base64")).toString("utf8") +
    decipher.final("utf8")
  );
}

export function encryptField<T extends string | null | undefined>(value: T): T {
  if (value == null) return value;
  return encrypt(value) as T;
}

export function decryptField<T extends string | null | undefined>(value: T): T {
  if (value == null) return value;
  return decrypt(value) as T;
}

export const ENC_PREFIX = PREFIX;
