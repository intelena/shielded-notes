import { bigintToBytes, fromHex, hashFields, randomHex32, stringToBytes } from "./hash.js";
import type { Hex32, KeyPair } from "./types.js";

/** Derive a pool key pair from a 32-byte seed (e.g. a wallet signature hash). */
export function keyPairFromSeed(seed: Hex32): KeyPair {
  const spendingKey = hashFields("intelena/spending-key", [fromHex(seed)]);
  return { spendingKey, pubKey: pubKeyFromSpendingKey(spendingKey) };
}

export function generateKeyPair(): KeyPair {
  return keyPairFromSeed(randomHex32());
}

export function pubKeyFromSpendingKey(spendingKey: Hex32): Hex32 {
  return hashFields("intelena/pubkey", [fromHex(spendingKey)]);
}

/**
 * Derive a child spending key for an account index — lets one seed back many
 * unlinkable pool identities (one per bot, per venue, per purpose).
 */
export function deriveChildKeyPair(parent: KeyPair, index: number): KeyPair {
  if (!Number.isInteger(index) || index < 0) throw new RangeError("index must be a non-negative integer");
  const spendingKey = hashFields("intelena/child-key", [
    fromHex(parent.spendingKey),
    bigintToBytes(BigInt(index)),
    stringToBytes("child"),
  ]);
  return { spendingKey, pubKey: pubKeyFromSpendingKey(spendingKey) };
}
