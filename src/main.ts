import "./styles/app.css";
import "./styles/sheet.css";
import { splitChunks, type EcLevel } from "./chunk";
import { decryptText, encryptText, estimateBits, generatePassphrase } from "./crypto";
import { $, h } from "./dom";
import { buildSheet, impose, layout, PAPER, type Columns, type Imposition, type Paper, type PrintOn } from "./page";
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
const tabsEl = $("#tabs");
const removeBtn = $<HTMLButtonElement>("#remove-card");
const printOnHint = $("#printon-hint");
const fillField = $("#fill-field");
const fillIn = $<HTMLInputElement>("#fill");

interface Card {
  title: string;
  secret: string;
  note: string;
}
const blank = (): Card => ({ title: "", secret: "", note: "" });

/** Cards live only in memory. The title/secret/note inputs edit the active one. */
let cards: Card[] = [blank()];
let active = 0;

/** Ciphertext cache: re-encrypt only when a secret or the passphrase change. */
let ciphers = new Map<string, string>();
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

function loadCard(i: number) {
  active = i;
  const c = cards[i];
  titleIn.value = c.title;
  secretIn.value = c.secret;
  noteIn.value = c.note;
  $("#secret-count").textContent = `${new TextEncoder().encode(c.secret).length} bytes`;
  drawTabs();
}

function drawTabs() {
  const tabs = cards.map((c, i) => {
    const b = h(
      "button",
      { type: "button", class: "tab", role: "tab", "aria-selected": String(i === active), title: c.title || `Card ${i + 1}` },
      String(i + 1),
    );
    if (!c.secret.trim()) b.classList.add("empty");
    b.addEventListener("click", () => {
      loadCard(i);
      secretIn.focus();
    });
    return b;
  });
  const add = h("button", { type: "button", class: "tab add", title: "Add a card", "aria-label": "Add a card" }, "+");
  add.addEventListener("click", () => {
    cards.push(blank());
    loadCard(cards.length - 1);
    titleIn.focus();
    schedule(0);
  });
  tabsEl.replaceChildren(...tabs, add);
  removeBtn.hidden = cards.length < 2;
}

/** Disable sheet sizes the card doesn't fit on twice; fall back to "own page". */
function syncPrintOn(paper: Paper): Imposition | null {
  for (const input of form.querySelectorAll<HTMLInputElement>('input[name="printon"]')) {
    input.disabled = input.value !== "same" && !impose(paper, input.value as PrintOn);
    if (input.disabled && input.checked) {
      form.querySelector<HTMLInputElement>('input[name="printon"][value="same"]')!.checked = true;
    }
  }
  const on = radio("printon") as PrintOn;
  const imp = impose(paper, on);
  printOnHint.hidden = fillField.hidden = !imp;
  if (imp) {
    const per = imp.cols * imp.rows;
    printOnHint.textContent = `${per} × ${paper} on each ${on} (${imp.w > imp.h ? "landscape" : "portrait"}). Cut along the dashed lines.`;
  }
  return imp;
}

async function render() {
  const id = ++run;
  const paper = radio("paper") as Paper;
  const ec = radio("ec") as EcLevel;
  const encrypted = encryptIn.checked;
  const pass = passIn.value;
  const p = PAPER[paper];
  const imp = syncPrintOn(paper);
  // Explicit mm: Chrome doesn't know the "A6" size keyword. Imposed sheets print edge to edge;
  // each card keeps its own inner margin instead.
  pageSheet.replaceSync(
    imp
      ? `@page { size: ${imp.w}mm ${imp.h}mm; margin: 0; }`
      : `@page { size: ${p.w}mm ${p.h}mm; margin: ${p.margin}mm; }`,
  );
  $("#secret-count").textContent = `${new TextEncoder().encode(secretIn.value).length} bytes`;
  printBtn.disabled = true;
  // Columns only make sense for a readable plaintext copy, not armored ciphertext.
  columnsField.disabled = encrypted || !includeText.checked;
  drawTabs();

  const filled = cards.map((c) => c.secret.trim().length > 0);
  const many = cards.length > 1;
  let ready = filled.every(Boolean);

  if (!ready) {
    const empty = filled.indexOf(false);
    setStatus("", many ? `Card ${empty + 1} is empty. Paste something, or remove it.` : "Paste something to back up.");
  }

  if (encrypted && ready) {
    if (!pass) {
      ready = false;
      setStatus("warn", "Enter a passphrase, or turn encryption off.");
    } else if (pass !== pass2In.value) {
      ready = false;
      setStatus("warn", pass2In.value ? "Passphrases don't match." : "Confirm the passphrase.");
    }
  }

  const payloads = cards.map((c) => c.secret);
  if (encrypted && ready) {
    const next = new Map<string, string>();
    for (const [i, c] of cards.entries()) {
      const key = `${pass}\u0000${c.secret}`;
      let armored = ciphers.get(key) ?? next.get(key);
      if (!armored) {
        setStatus("busy", `Encrypting${many ? ` card ${i + 1}` : ""}…`);
        armored = await encryptText(c.secret, pass);
        if (id !== run) return;
        setStatus("busy", "Checking it decrypts…");
        const back = await decryptText(armored, pass);
        if (id !== run) return;
        if (back !== c.secret) {
          setStatus("warn", `Self-check failed: ${many ? `card ${i + 1}` : "the ciphertext"} did not decrypt back. Don't print this.`);
          return;
        }
      }
      next.set(key, armored);
      payloads[i] = armored;
    }
    ciphers = next;
  }

  const chunks = payloads.map((pl) => splitChunks(pl || " ", ec));
  const qrs = await Promise.all(chunks.map((cs) => Promise.all(cs.map((c) => qrSvg(c, ec)))));
  if (id !== run) return;

  const created = new Date();
  const sheets = cards.map((c, i) => {
    // Unencrypted cards preview as soon as they have text; encrypted ones once everything is ready.
    const ok = encrypted ? ready : filled[i];
    const sheet = buildSheet({
      title: c.title.trim(),
      note: c.note.trim(),
      paper,
      ec,
      encrypted,
      qrs: ok ? qrs[i] : [],
      payload: ok ? payloads[i] : "",
      includeText: includeText.checked && ok,
      columns: encrypted ? "off" : (radio("columns") as Columns),
      created,
    });
    if (!ok) sheet.classList.add("is-empty");
    return sheet;
  });
  // Fill the last imposed sheet's empty spots with repeats of the cards, in order.
  if (imp && fillIn.checked) {
    const per = imp.cols * imp.rows;
    const n = sheets.length;
    for (let i = 0; sheets.length % per; i++) sheets.push(sheets[i % n].cloneNode(true) as HTMLElement);
  }
  scaler.replaceChildren(layout(sheets, paper, imp));
  const { overflow } = fit();

  if (!ready) return;

  // Scan every QR back from its matrix to prove it decodes to what we meant.
  for (const [i, cs] of chunks.entries()) {
    if (!cs.every((c) => scanBack(c, ec) === c)) {
      setStatus("warn", `${many ? `Card ${i + 1}: a` : "A"} QR code failed to scan back. Try a lower error-correction level.`);
      return;
    }
  }
  if (overflow.length) {
    const names = many ? overflow.map((i) => `Card ${i + 1}`).join(", ") : "The card";
    setStatus(
      "warn",
      `${names} ${overflow.length > 1 ? "don't fit their spots" : "doesn't fit its spot"} on the sheet. ` +
        "Use a bigger card, print each on its own page, or turn off the text copy.",
    );
    return;
  }
  const all = chunks.flat();
  const v = Math.max(...all.map((c) => qrVersion(c, ec)));
  const multi = all.length > 1;
  const verb = multi ? "scan" : "scans";
  const what = encrypted ? `${verb} and decrypt${multi ? "" : "s"} back to your input` : `${verb} back to your input`;
  const which = !multi ? "the QR code" : many ? `all ${all.length} QR codes on ${cards.length} cards` : `all ${all.length} QR codes`;
  setStatus("ok", `Verified: ${which} ${what}. QR version ${v}.`);
  printBtn.disabled = false;
}

/** Scale the true-size pages to fit the preview, and flag page overflow. Returns overflowing card indexes. */
function fit(): { overflow: number[] } {
  const stack = scaler.firstElementChild as HTMLElement | null;
  if (!stack) return { overflow: [] };
  const name = radio("paper") as Paper;
  const paper = PAPER[name];
  const sheets = [...stack.querySelectorAll<HTMLElement>(".sheet")];
  const overflow: number[] = [];

  if (stack.classList.contains("imposed")) {
    // A card can't spill onto another page here: it has to fit its spot. Same 1% slack as
    // below: a little overrun only eats into the card's own bottom margin.
    sheets.forEach((s, i) => {
      const over = s.scrollHeight > s.clientHeight * 1.01;
      s.classList.toggle("overflowing", over);
      if (over && i < cards.length) overflow.push(i);
    });
    const pages = stack.children.length;
    overflowEl.textContent = overflow.length
      ? `${overflow.length} card${overflow.length > 1 ? "s" : ""} too long`
      : `${pages} × ${radio("printon")} · ${sheets.length} card${sheets.length > 1 ? "s" : ""}`;
    overflowEl.classList.toggle("warn", overflow.length > 0);
  } else {
    let pages = 0;
    let spills = false;
    for (const s of sheets) {
      const mm = s.offsetWidth / paper.w;
      // Printed content area per page excludes the @page margins.
      const content = s.scrollHeight - 2 * paper.margin * mm;
      const perPage = (paper.h - 2 * paper.margin) * mm;
      const n = Math.max(1, Math.ceil(content / perPage - 0.01));
      spills ||= n > 1;
      pages += n;
    }
    overflowEl.textContent = `${name} · ${pages} page${pages > 1 ? "s" : ""}`;
    overflowEl.classList.toggle("warn", spills);
  }

  // The scaler takes the scaled footprint; the stack inside keeps true size and is transformed.
  const pad = parseFloat(getComputedStyle(desk).paddingLeft) * 2;
  const scale = Math.min(1, (desk.clientWidth - pad) / stack.offsetWidth);
  stack.style.transform = `scale(${scale})`;
  scaler.style.width = `${stack.offsetWidth * scale}px`;
  scaler.style.height = `${stack.offsetHeight * scale}px`;
  return { overflow };
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
  const c = cards[active];
  if (e.target === titleIn) c.title = titleIn.value;
  if (e.target === secretIn) c.secret = secretIn.value;
  if (e.target === noteIn) c.note = noteIn.value;
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

removeBtn.addEventListener("click", () => {
  if (cards.length < 2) return;
  cards.splice(active, 1);
  loadCard(Math.min(active, cards.length - 1));
  schedule(0);
});

new ResizeObserver(fit).observe(desk);

// Browsers restore form fields on reload/back. Never resurrect a secret: start clean.
function fresh() {
  form.reset();
  passIn.type = pass2In.type = "password";
  passFields.hidden = true;
  ciphers = new Map();
  cards = [blank()];
  loadCard(0);
  meter();
  schedule(0);
}
window.addEventListener("pageshow", fresh);
fresh();
