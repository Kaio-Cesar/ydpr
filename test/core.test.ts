import { describe, expect, it } from "vitest";
import { decryptText, encryptText, estimateBits, generatePassphrase, isAgeArmor } from "../src/crypto";
import { joinChunks, parseChunk, splitChunks } from "../src/chunk";
import { scanBack as scan } from "../src/verify";

const CODES = Array.from({ length: 10 }, (_, i) => `abcd-${1000 + i}-efgh`).join("\n");


describe("crypto", () => {
  it("round-trips through age armor", async () => {
    const armored = await encryptText(CODES, "correct horse");
    expect(isAgeArmor(armored)).toBe(true);
    expect(await decryptText(armored, "correct horse")).toBe(CODES);
  });

  it("rejects a wrong passphrase", async () => {
    const armored = await encryptText(CODES, "right");
    await expect(decryptText(armored, "wrong")).rejects.toThrow();
  });

  it("generates strong passphrases", () => {
    const p = generatePassphrase();
    expect(p).toMatch(/^([0-9a-z]{4}-){5}[0-9a-z]{4}$/);
    expect(estimateBits("")).toBe(0);
  });
});

describe("chunks", () => {
  it("leaves small data bare", () => {
    expect(splitChunks("hello", "M")).toEqual(["hello"]);
  });

  it("splits and rejoins large data in any order", () => {
    const big = "é".repeat(3000) + CODES;
    const parts = splitChunks(big, "H");
    expect(parts.length).toBeGreaterThan(1);
    const parsed = parts.map(parseChunk).reverse();
    expect(joinChunks(parsed)).toBe(big);
    expect(joinChunks(parsed.slice(1))).toBeNull();
  });
});

describe("QR end to end", () => {
  it("encrypt → QR → scan → decrypt", async () => {
    const armored = await encryptText(CODES, "pass");
    for (const ec of ["L", "M", "Q", "H"] as const) {
      const scanned = splitChunks(armored, ec).map((c) => scan(c, ec)!);
      const joined = joinChunks(scanned.map(parseChunk))!;
      expect(await decryptText(joined, "pass")).toBe(CODES);
    }
  }, 30000);
});
