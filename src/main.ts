import "./styles/app.css";
import "./styles/sheet.css";
import { splitChunks, type EcLevel } from "./chunk";
import { decryptText, encryptText, estimateBits, generatePassphrase } from "./crypto";
import { $ } from "./dom";
import { buildSheet, PAPER, type Columns, type Paper } from "./page";
import { qrSvg } from "./qr";
import { qrVersion, scanBack } from "./verify";
import { registerOffline } from "./pwa";

registerOffline();

const form = $<HTMLFormElement>("#form");
const titleIn = $<HTMLInputElement>("#title");
const secretIn = $<HTMLTextAreaElement>("#secret");
const noteIn = $<HTMLInputElement>("#note");
const includeText = $<HTMLInputElement>("#include-text");
const columnsField = $<HTMLFieldSetElement>("#columns-field");
const encryptIn = $<HTMLInputElement>("#encrypt");
const passFields = $("#pass-fields");
const passIn = $<HTMLInputElement>("#pass");
const pass2In = $<HTMLInputElement>("#pass2");
const statusEl = $("#status");
const printBtn = $<HTMLButtonElement>("#print");
const scaler = $("#scaler");
const desk = $("#desk");
const overflowEl = $("#overflow");

/** Ciphertext cache: re-encrypt only when the secret or passphrase change. */
let cipher: { key: string; armored: string } | null = null;
let run = 0;
let timer: number | undefined;

/** @page rules can't be scoped to a class, so we swap one constructed stylesheet. */
const pageSheet = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];

const radio = (name: string) => (form.elements.namedItem(name) as RadioNodeList).value;

function setStatus(kind: "ok" | "warn" | "busy" | "", text: string) {
  statusEl.className = `status ${kind}`;
  statusEl.textContent = text;
}

function schedule(delay = 250) {
  clearTimeout(timer);
  timer = window.setTimeout(render, delay);
}

async function render() {
  const id = ++run;
  const paper = radio("paper") as Paper;
  const ec = radio("ec") as EcLevel;
  const secret = secretIn.value;
  const encrypted = encryptIn.checked;
  const pass = passIn.value;
  const p = PAPER[paper];
  // Explicit mm: Chrome doesn't know the "A6" size keyword.
  pageSheet.replaceSync(`@page { size: ${p.w}mm ${p.h}mm; margin: ${p.margin}mm; }`);
  $("#secret-count").textContent = `${new TextEncoder().encode(secret).length} bytes`;
  printBtn.disabled = true;
  // Columns only make sense for a readable plaintext copy, not armored ciphertext.
  columnsField.disabled = encrypted || !includeText.checked;

  let payload = secret;
  let ready = secret.trim().length > 0;

  if (!ready) setStatus("", "Paste something to back up.");

  if (encrypted && ready) {
    if (!pass) {
      ready = false;
      setStatus("warn", "Enter a passphrase, or turn encryption off.");
    } else if (pass !== pass2In.value) {
      ready = false;
      setStatus("warn", pass2In.value ? "Passphrases don't match." : "Confirm the passphrase.");
    } else {
      const key = `${pass}\u0000${secret}`;
      if (cipher?.key !== key) {
        setStatus("busy", "Encrypting…");
        const armored = await encryptText(secret, pass);
        if (id !== run) return;
        setStatus("busy", "Checking it decrypts…");
        const back = await decryptText(armored, pass);
        if (id !== run) return;
        if (back !== secret) {
          setStatus("warn", "Self-check failed: ciphertext did not decrypt back. Don't print this.");
          return;
        }
        cipher = { key, armored };
      }
      payload = cipher.armored;
    }
  }

  const chunks = splitChunks(payload || " ", ec);
  const qrs = await Promise.all(chunks.map((c) => qrSvg(c, ec)));
  if (id !== run) return;

  const sheet = buildSheet({
    title: titleIn.value.trim(),
    note: noteIn.value.trim(),
    paper,
    ec,
    encrypted,
    qrs: ready ? qrs : [],
    payload: ready ? payload : "",
    includeText: includeText.checked && ready,
    columns: encrypted ? "off" : (radio("columns") as Columns),
    created: new Date(),
  });
  if (!ready) sheet.classList.add("is-empty");
  scaler.replaceChildren(sheet);
  fit();

  if (!ready) return;

  // Scan every QR back from its matrix to prove it decodes to what we meant.
  const scanned = chunks.every((c) => scanBack(c, ec) === c);
  if (!scanned) {
    setStatus("warn", "A QR code failed to scan back. Try a lower error-correction level.");
    return;
  }
  const v = Math.max(...chunks.map((c) => qrVersion(c, ec)));
  const many = chunks.length > 1;
  const verb = many ? "scan" : "scans";
  const what = encrypted ? `${verb} and decrypt${many ? "" : "s"} back to your input` : `${verb} back to your input`;
  setStatus("ok", `Verified: ${many ? `all ${chunks.length} QR codes` : "the QR code"} ${what}. QR version ${v}.`);
  printBtn.disabled = false;
}

/** Scale the true-size sheet to fit the preview, and flag page overflow. */
function fit() {
  const sheet = scaler.firstElementChild as HTMLElement | null;
  if (!sheet) return;
  const paper = PAPER[radio("paper") as Paper];
  const mm = sheet.offsetWidth / paper.w;
  // Printed content area per page excludes the @page margins.
  const content = sheet.scrollHeight - 2 * paper.margin * mm;
  const perPage = (paper.h - 2 * paper.margin) * mm;
  const pages = Math.max(1, Math.ceil(content / perPage - 0.01));
  overflowEl.textContent = pages > 1 ? `${pages} pages` : `${radio("paper")} · 1 page`;
  overflowEl.classList.toggle("warn", pages > 1);

  // The scaler takes the scaled footprint; the sheet inside keeps true size and is transformed.
  const pad = parseFloat(getComputedStyle(desk).paddingLeft) * 2;
  const scale = Math.min(1, (desk.clientWidth - pad) / sheet.offsetWidth);
  sheet.style.transform = `scale(${scale})`;
  scaler.style.width = `${sheet.offsetWidth * scale}px`;
  scaler.style.height = `${sheet.offsetHeight * scale}px`;
}

function meter() {
  const bits = estimateBits(passIn.value);
  const pct = Math.min(100, (bits / 100) * 100);
  const bar = $("#meter-bar");
  bar.style.width = `${pct}%`;
  const level = bits < 45 ? "weak" : bits < 70 ? "fair" : "strong";
  bar.dataset.level = level;
  $("#meter-text").textContent = passIn.value
    ? `~${bits} bits · ${level}${level === "weak" ? ". Anyone with this page can try guesses offline." : ""}`
    : "Use 4+ random words or 12+ random characters.";
}

form.addEventListener("input", (e) => {
  if (e.target === passIn) meter();
  const slow = e.target === secretIn || e.target === passIn || e.target === pass2In;
  schedule(slow && encryptIn.checked ? 600 : 150);
});
form.addEventListener("submit", (e) => e.preventDefault());

encryptIn.addEventListener("change", () => {
  passFields.hidden = !encryptIn.checked;
  if (encryptIn.checked) passIn.focus();
});

$("#gen").addEventListener("click", () => {
  const p = generatePassphrase();
  passIn.value = pass2In.value = p;
  passIn.type = "text";
  $("#show-pass").setAttribute("aria-pressed", "true");
  $("#show-pass").textContent = "Hide";
  meter();
  setStatus("warn", "Store this passphrase somewhere safe before printing. It is not on the page.");
  schedule(0);
});

$("#show-pass").addEventListener("click", (e) => {
  const show = passIn.type === "password";
  passIn.type = pass2In.type = show ? "text" : "password";
  const btn = e.currentTarget as HTMLButtonElement;
  btn.setAttribute("aria-pressed", String(show));
  btn.textContent = show ? "Hide" : "Show";
});

printBtn.addEventListener("click", () => window.print());

$("#clear").addEventListener("click", () => fresh());

new ResizeObserver(fit).observe(desk);

// Browsers restore form fields on reload/back. Never resurrect a secret: start clean.
function fresh() {
  form.reset();
  passIn.type = pass2In.type = "password";
  passFields.hidden = true;
  cipher = null;
  meter();
  schedule(0);
}
window.addEventListener("pageshow", fresh);
fresh();
