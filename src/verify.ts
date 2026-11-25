import QRCode from "qrcode";
import jsQR from "jsqr";
import type { EcLevel } from "./chunk";

/** Rasterize the exact QR matrix we print and scan it back with jsQR. */
export function scanBack(data: string, ec: EcLevel): string | null {
  const qr = QRCode.create(data, { errorCorrectionLevel: ec });
  const n = qr.modules.size, scale = 3, quiet = 4;
  const w = (n + quiet * 2) * scale;
  const px = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const o = (((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx) * 4;
          px[o] = px[o + 1] = px[o + 2] = 0;
        }
    }
  return jsQR(px, w, w, { inversionAttempts: "dontInvert" })?.data ?? null;
}

/** QR version (1-40) the data will need. */
export function qrVersion(data: string, ec: EcLevel): number {
  return QRCode.create(data, { errorCorrectionLevel: ec }).version;
}
