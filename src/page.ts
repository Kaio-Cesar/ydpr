import type { EcLevel } from "./chunk";
import { appUrl, h } from "./dom";

export type Paper = "A4" | "A5" | "A6";
/** Text-copy layout: "off" keeps the text as typed; otherwise one numbered line per item. */
export type Columns = "off" | "auto" | "1" | "2" | "3" | "4";

/** Paper size and print margin, in millimetres. */
export const PAPER: Record<Paper, { w: number; h: number; margin: number }> = {
  A4: { w: 210, h: 297, margin: 16 },
  A5: { w: 148, h: 210, margin: 12 },
  A6: { w: 105, h: 148, margin: 8 },
};

const EC_LABEL: Record<EcLevel, string> = { L: "L · 7%", M: "M · 15%", Q: "Q · 25%", H: "H · 30%" };

export interface SheetData {
  title: string;
  note: string;
  paper: Paper;
  ec: EcLevel;
  encrypted: boolean;
  /** One SVG string per QR chunk. */
  qrs: string[];
  /** What the QR codes hold, joined (plaintext or armored ciphertext). */
  payload: string;
  includeText: boolean;
  columns: Columns;
  created: Date;
}

export function buildSheet(d: SheetData): HTMLElement {
  const n = d.qrs.length;
  const recoverUrl = appUrl("recover.html");

  const meta = h(
    "dl",
    { class: "s-meta" },
    ...metaRow("Created", d.created.toISOString().slice(0, 10)),
    ...metaRow("Encryption", d.encrypted ? "age · scrypt passphrase" : "None"),
    ...metaRow("Error corr.", EC_LABEL[d.ec]),
    ...metaRow("QR codes", n === 0 ? "–" : n === 1 ? "1" : `${n} (scan all)`),
  );

  const qrs = h(
    "div",
    { class: `s-qrs ${n === 1 ? "single" : "multi"}` },
    ...d.qrs.map((svg, i) => {
      const fig = h("figure", { class: "s-qr" });
      fig.append(svgNode(svg));
      if (n > 1) fig.append(h("figcaption", null, `${i + 1} / ${n}`));
      return fig;
    }),
  );

  const howto = h(
    "section",
    { class: "s-howto" },
    h("h2", null, "How to recover"),
    d.encrypted ? encryptedSteps(recoverUrl, n) : plainSteps(recoverUrl, n),
  );

  return h(
    "article",
    { class: `sheet paper-${d.paper.toLowerCase()}` },
    h(
      "header",
      { class: "s-head" },
      h("div", { class: "s-kicker" }, "You did print it, right?"),
      h("h1", { class: "s-title" }, d.title || "Untitled backup"),
      meta,
    ),
    h("div", { class: "s-body" }, qrs, howto),
    d.note && h("section", { class: "s-note" }, h("h2", null, "Note"), h("p", null, d.note)),
    d.includeText &&
      h(
        "section",
        { class: "s-text" },
        h("h2", null, d.encrypted ? "Ciphertext (age, armored)" : "Text copy"),
        d.encrypted || d.columns === "off" ? h("pre", null, d.payload) : codeList(d.payload, d.columns),
      ),
    h(
      "footer",
      { class: "s-foot" },
      h("span", null, "ydpr"),
      h("span", null, recoverUrl),
      h("span", null, "Made offline. Nothing was uploaded."),
    ),
  );
}

function metaRow(k: string, v: string): Node[] {
  return [h("dt", null, k), h("dd", null, v)];
}

function svgNode(svg: string): Node {
  // The SVG comes from the qrcode library (our own data), parsed as image XML, not HTML.
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const el = doc.documentElement;
  el.removeAttribute("width");
  el.removeAttribute("height");
  el.setAttribute("shape-rendering", "crispEdges");
  return document.importNode(el, true);
}

function scanStep(n: number): HTMLElement {
  return n <= 1
    ? h("li", null, "Scan the QR code with any phone camera or QR app and copy the text.")
    : h(
        "li",
        null,
        `Scan all ${n} QR codes. Each starts with `,
        h("code", null, "YDPR:i/n:"),
        `. The recover page joins them for you. By hand: drop that prefix and paste the parts in order.`,
      );
}

function encryptedSteps(url: string, n: number): HTMLElement {
  return h(
    "ol",
    null,
    scanStep(n),
    h(
      "li",
      null,
      h("strong", null, "With this app: "),
      "open ",
      h("code", null, url),
      ", scan or paste, then enter the passphrase.",
    ),
    h(
      "li",
      null,
      h("strong", null, "Without it: "),
      "save the text as ",
      h("code", null, "backup.age"),
      ", install age (age-encryption.org) and run ",
      h("code", null, "age -d backup.age"),
      ". Enter the passphrase.",
    ),
    h("li", null, "The passphrase is not on this page. It was stored separately."),
  );
}

function plainSteps(url: string, n: number): HTMLElement {
  return h(
    "ol",
    null,
    scanStep(n),
    h("li", null, "Or open ", h("code", null, url), " to scan and join the codes."),
    h("li", null, "This page is not encrypted. Keep it somewhere only you can reach."),
  );
}

/** One numbered item per non-empty line, flowed into columns. */
function codeList(text: string, columns: Exclude<Columns, "off">): HTMLElement {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const longest = Math.max(...lines.map((l) => [...l].length), 1);
  const digits = String(lines.length).length;
  const ol = h(
    "ol",
    { class: "s-codes" },
    ...lines.map((l, i) =>
      h("li", null, h("span", { class: "n" }, String(i + 1).padStart(digits, "0")), h("span", { class: "c" }, l)),
    ),
  );
  // Auto: let CSS fit as many columns as the longest line allows.
  if (columns === "auto") ol.style.setProperty("--colw", `${longest + digits + 3}ch`);
  else ol.style.setProperty("--cols", columns);
  ol.classList.add(columns === "auto" ? "auto" : "fixed");
  return ol;
}
