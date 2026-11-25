export type EcLevel = "L" | "M" | "Q" | "H";

/**
 * Max payload bytes per QR, per error-correction level. Chosen to keep each code
 * around version 25 (117 modules) so it still scans when printed small on A6.
 */
export const CHUNK_BYTES: Record<EcLevel, number> = { L: 1000, M: 800, Q: 560, H: 430 };

const PREFIX_RE = /^YDPR:(\d+)\/(\d+):/;

/** Split data into QR payloads. A single chunk is left bare (so it is a valid age file as-is). */
export function splitChunks(data: string, ec: EcLevel): string[] {
  const max = CHUNK_BYTES[ec] - 16; // room for the "YDPR:n/m:" prefix
  if (byteLen(data) <= CHUNK_BYTES[ec]) return [data];
  const parts: string[] = [];
  let cur = "";
  for (const ch of data) {
    if (byteLen(cur + ch) > max) {
      parts.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map((p, i) => `YDPR:${i + 1}/${parts.length}:${p}`);
}

export interface ParsedChunk {
  index: number; // 1-based
  total: number;
  body: string;
}

export function parseChunk(text: string): ParsedChunk {
  const m = PREFIX_RE.exec(text);
  if (!m) return { index: 1, total: 1, body: text };
  return { index: Number(m[1]), total: Number(m[2]), body: text.slice(m[0].length) };
}

/** Join chunks (any order). Returns null if some are missing. */
export function joinChunks(chunks: ParsedChunk[]): string | null {
  if (!chunks.length) return null;
  const total = chunks[0].total;
  const byIndex = new Map(chunks.map((c) => [c.index, c.body]));
  const out: string[] = [];
  for (let i = 1; i <= total; i++) {
    const b = byIndex.get(i);
    if (b === undefined) return null;
    out.push(b);
  }
  return out.join("");
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}
