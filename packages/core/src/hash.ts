import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import type { Hex32 } from "./types.js";

/**
 * Domain-separated hash over a list of 32-byte fields.
 * The reference implementation uses SHA-256; production circuits use Poseidon
 * over the BN254 scalar field. Swap via `setHasher()` — every commitment,
 * nullifier and Merkle node goes through this one function.
 */
export type Hasher = (domain: string, fields: Uint8Array[]) => Uint8Array;

const textEncoder = new TextEncoder();

export const sha256Hasher: Hasher = (domain, fields) => {
  const h = sha256.create();
  const tag = textEncoder.encode(domain);
  h.update(new Uint8Array([tag.length]));
  h.update(tag);
  for (const f of fields) h.update(f);
  return h.digest();
};

let hasher: Hasher = sha256Hasher;

export function setHasher(next: Hasher): void {
  hasher = next;
}

export function hashFields(domain: string, fields: Uint8Array[]): Hex32 {
  return toHex(hasher(domain, fields));
}

export function toHex(bytes: Uint8Array): Hex32 {
  return `0x${bytesToHex(bytes)}`;
}

export function fromHex(hex: string): Uint8Array {
  return hexToBytes(hex.startsWith("0x") ? hex.slice(2) : hex);
}

export function isHex32(value: unknown): value is Hex32 {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
}

/** Big-endian 32-byte encoding of a non-negative bigint. */
export function bigintToBytes(value: bigint): Uint8Array {
  if (value < 0n) throw new RangeError("negative value");
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0 && v > 0n; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v > 0n) throw new RangeError("value does not fit in 32 bytes");
  return out;
}

export function stringToBytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

/** Cryptographically random 32 bytes as hex. */
export function randomHex32(): Hex32 {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}
