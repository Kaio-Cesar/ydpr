import QRCode from "qrcode";
import type { EcLevel } from "./chunk";

/** Render a QR code as an SVG string (black on white, 4-module quiet zone). */
export function qrSvg(data: string, ec: EcLevel): Promise<string> {
  return QRCode.toString(data, {
    type: "svg",
    errorCorrectionLevel: ec,
    margin: 4,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
