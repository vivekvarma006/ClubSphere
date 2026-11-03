import "server-only";
import QRCode from "qrcode";

/** Renders `text` as an SVG QR code (server-side, no external service involved). */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } });
}
