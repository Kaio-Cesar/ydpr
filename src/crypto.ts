import { Decrypter, Encrypter, armor } from "age-encryption";

export const AGE_ARMOR_HEADER = "-----BEGIN AGE ENCRYPTED FILE-----";

/** Encrypt text with a passphrase (age: scrypt + ChaCha20-Poly1305), ASCII-armored. */
export async function encryptText(text: string, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error("Passphrase is required");
  const e = new Encrypter();
  e.setPassphrase(passphrase);
  const bin = await e.encrypt(text);
  return armor.encode(bin).trimEnd();
}

/** Decrypt an ASCII-armored age file with a passphrase. */
export async function decryptText(armored: string, passphrase: string): Promise<string> {
  const d = new Decrypter();
  d.addPassphrase(passphrase);
  return d.decrypt(armor.decode(armored.trim()), "text");
}

export function isAgeArmor(text: string): boolean {
  return text.trimStart().startsWith(AGE_ARMOR_HEADER);
}

const PASS_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, lowercase

/** Random passphrase: 6 groups of 4 base32 chars (120 bits). Easy to read off paper. */
export function generatePassphrase(groups = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(groups * 4));
  const chars = Array.from(bytes, (b) => PASS_ALPHABET[b & 31]);
  const out: string[] = [];
  for (let i = 0; i < groups; i++) out.push(chars.slice(i * 4, i * 4 + 4).join(""));
  return out.join("-");
}

/** Rough entropy estimate in bits, based on character classes used. */
export function estimateBits(pass: string): number {
  if (!pass) return 0;
  let pool = 0;
  if (/[a-z]/.test(pass)) pool += 26;
  if (/[A-Z]/.test(pass)) pool += 26;
  if (/[0-9]/.test(pass)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pass)) pool += 33;
  const unique = new Set(pass).size;
  return Math.round(Math.min(pass.length, unique * 2) * Math.log2(Math.max(pool, 2)));
}
