import "./styles/app.css";
import jsQR from "jsqr";
import { joinChunks, parseChunk, type ParsedChunk } from "./chunk";
import { decryptText, isAgeArmor } from "./crypto";
import { $, h } from "./dom";
import { registerOffline } from "./pwa";

registerOffline();

const video = $<HTMLVideoElement>("#video");
const videoWrap = $("#video-wrap");
const camBtn = $<HTMLButtonElement>("#cam");
const paste = $<HTMLTextAreaElement>("#paste");
const chipsEl = $("#chips");
const scanStatus = $("#scan-status");
const decCard = $("#decrypt-card");
const passIn = $<HTMLInputElement>("#passphrase");
const decStatus = $("#dec-status");
const resultCard = $("#result-card");
const resultEl = $("#result");

/** Collected chunks by index. A bare (unprefixed) scan is chunk 1 of 1. */
let chunks = new Map<number, ParsedChunk>();
let total = 0;
let joined: string | null = null;
let stream: MediaStream | null = null;

function status(el: HTMLElement, kind: "ok" | "warn" | "bad" | "busy" | "", text: string) {
  el.className = `status ${kind}`;
  el.textContent = text;
}

/** Feed one scanned or pasted text into the collection. Returns true when it was new. */
function add(text: string): boolean {
  text = text.replace(/\r\n/g, "\n").trim();
  if (!text) return false;
  const c = parseChunk(text);
  if (total && c.total !== total) {
    status(scanStatus, "warn", `That code belongs to a set of ${c.total}, but this set has ${total}. Start over to switch.`);
    return false;
  }
  if (chunks.has(c.index)) return false;
  total = c.total;
  chunks.set(c.index, c);
  update();
  return true;
}

function update() {
  chipsEl.replaceChildren(
    ...Array.from({ length: total }, (_, i) =>
      h("span", { class: `chip ${chunks.has(i + 1) ? "have" : ""}` }, total > 1 ? `${i + 1}/${total}` : "QR"),
    ),
  );
  joined = joinChunks([...chunks.values()]);
  if (!joined) {
    status(scanStatus, "busy", `Got ${chunks.size} of ${total}. Keep scanning.`);
    return;
  }
  stopCamera();
  if (isAgeArmor(joined)) {
    status(scanStatus, "ok", "Got everything. It's encrypted.");
    decCard.hidden = false;
    passIn.focus();
  } else {
    status(scanStatus, "ok", "Got everything. It's not encrypted.");
    show(joined);
  }
}

function show(text: string) {
  resultEl.textContent = text;
  resultCard.hidden = false;
  resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── QR decoding ──────────────────────────────────────────────

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
const NativeDetector = (globalThis as { BarcodeDetector?: new (o: object) => Detector }).BarcodeDetector;
const native: Detector | null = NativeDetector ? new NativeDetector({ formats: ["qr_code"] }) : null;

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

/** Decode every QR we can find in an image or video frame. */
async function decode(src: HTMLVideoElement | ImageBitmap): Promise<string[]> {
  if (native) {
    try {
      const found = await native.detect(src);
      if (found.length) return found.map((f) => f.rawValue);
    } catch {
      /* fall back to jsQR */
    }
  }
  const w = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
  const hgt = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
  if (!w || !hgt) return [];
  // jsQR finds one code per call; downscale huge photos for speed.
  const scale = Math.min(1, 1600 / Math.max(w, hgt));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(hgt * scale);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const r = jsQR(img.data, img.width, img.height);
  return r ? [r.data] : [];
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 } },
      audio: false,
    });
  } catch (e) {
    status(scanStatus, "bad", `Camera unavailable: ${(e as Error).message}. Try a photo or paste instead.`);
    return;
  }
  video.srcObject = stream;
  videoWrap.hidden = false;
  camBtn.textContent = "Stop camera";
  await video.play();
  status(scanStatus, "busy", "Point the camera at a QR code.");
  const tick = async () => {
    if (!stream) return;
    for (const text of await decode(video)) add(text);
    if (stream) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  videoWrap.hidden = true;
  camBtn.textContent = "Use camera";
}

camBtn.addEventListener("click", () => (stream ? stopCamera() : startCamera()));

$<HTMLInputElement>("#file").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  status(scanStatus, "busy", "Reading photo…");
  try {
    const bmp = await createImageBitmap(file);
    const found = await decode(bmp);
    bmp.close();
    if (!found.length) {
      status(scanStatus, "warn", "No QR code found in that photo. Try closer, flatter and better lit.");
      return;
    }
    const added = found.filter(add).length;
    if (!added && !joined) status(scanStatus, "warn", "Already have that one.");
  } catch {
    status(scanStatus, "bad", "Couldn't open that image.");
  }
});

$("#use-paste").addEventListener("click", () => {
  if (add(paste.value)) paste.value = "";
  else if (!paste.value.trim()) status(scanStatus, "warn", "Paste some text first.");
});

// ── decryption ───────────────────────────────────────────────

async function decrypt() {
  if (!joined || !passIn.value) return;
  status(decStatus, "busy", "Decrypting…");
  try {
    const text = await decryptText(joined, passIn.value);
    status(decStatus, "ok", "Decrypted.");
    passIn.value = "";
    show(text);
  } catch {
    status(decStatus, "bad", "Wrong passphrase, or the text is damaged.");
  }
}
$("#decrypt").addEventListener("click", decrypt);
passIn.addEventListener("keydown", (e) => e.key === "Enter" && decrypt());

// ── result ───────────────────────────────────────────────────

$("#copy").addEventListener("click", async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(resultEl.textContent ?? "");
    btn.textContent = "Copied";
  } catch {
    btn.textContent = "Copy failed";
  }
  setTimeout(() => (btn.textContent = "Copy"), 1500);
});

function reset() {
  stopCamera();
  chunks = new Map();
  total = 0;
  joined = null;
  paste.value = "";
  passIn.value = "";
  resultEl.textContent = "";
  chipsEl.replaceChildren();
  decCard.hidden = resultCard.hidden = true;
  status(scanStatus, "", "");
  status(decStatus, "", "");
}
$("#reset").addEventListener("click", reset);
$("#wipe").addEventListener("click", reset);

// Browsers restore form fields on reload/back. Never resurrect a secret.
window.addEventListener("pageshow", reset);
