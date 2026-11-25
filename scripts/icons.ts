// Rasterizes the app icon (same geometry as public/icon.svg) to PNGs, with no image deps.
// Run: bun scripts/icons.ts
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

type Shape = (x: number, y: number) => boolean; // coords in the 512 design space
const rect = (x: number, y: number, w: number, h: number): Shape => (px, py) =>
  px >= x && px < x + w && py >= y && py < y + h;
const ring = (x: number, y: number) => (px: number, py: number) =>
  rect(x, y, 80, 80)(px, py) && !rect(x + 16, y + 16, 48, 48)(px, py);
const rounded = (r: number): Shape => (px, py) => {
  const cx = Math.min(Math.max(px, r), 512 - r), cy = Math.min(Math.max(py, r), 512 - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};

const BG = [13, 14, 17], WHITE = [255, 255, 255], FOLD = [201, 204, 211];
// The fold triangle: x in [312,376], y in [96,160], below the diagonal.
const fold: Shape = (x, y) => x >= 312 && y <= 160 && y >= 96 && x - 312 <= y - 96;
const page: Shape = (x, y) => rect(136, 96, 240, 320)(x, y) && !(x > 312 && y < 160 && x - 312 > y - 96);
const ink: Shape[] = [
  ring(168, 192), rect(196, 220, 24, 24),
  ring(264, 192), rect(292, 220, 24, 24),
  ring(168, 288), rect(196, 316, 24, 24),
  rect(264, 288, 24, 24), rect(304, 288, 40, 24), rect(264, 328, 40, 24),
  rect(320, 328, 24, 40), rect(264, 352, 24, 16),
];

function color(x: number, y: number, maskable: boolean): number[] | null {
  if (!maskable && !rounded(96)(x, y)) return null;
  if (ink.some((s) => s(x, y))) return BG;
  if (fold(x, y)) return FOLD;
  if (page(x, y)) return WHITE;
  return BG;
}

function render(size: number, maskable = false): Buffer {
  const ss = 4; // 4x4 supersampling
  // Maskable icons need content inside the 80% safe zone: shrink the art.
  const k = maskable ? 0.8 : 1, off = (512 * (1 - k)) / 2;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          let x = ((px + (sx + 0.5) / ss) / size) * 512, y = ((py + (sy + 0.5) / ss) / size) * 512;
          if (maskable) { x = (x - off) / k; y = (y - off) / k; }
          const c = color(x, y, maskable);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      const n = ss * ss, o = py * (size * 4 + 1) + 1 + px * 4;
      const cover = a / 255 || 1;
      raw[o] = r / cover; raw[o + 1] = g / cover; raw[o + 2] = b / cover; raw[o + 3] = a / n;
    }
  }
  return png(size, raw);
}

function png(size: number, raw: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

writeFileSync("public/icon-192.png", render(192));
writeFileSync("public/icon-512.png", render(512));
writeFileSync("public/icon-maskable-512.png", render(512, true));
writeFileSync("public/apple-touch-icon.png", render(180, true));
console.log("icons written");
