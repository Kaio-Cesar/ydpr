type Child = Node | string | null | undefined | false;

/** Tiny element builder. Text children are always set as text, never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T;

/** Absolute URL of the app root (works under the GitHub Pages sub-path). */
export function appUrl(path = ""): string {
  return new URL(import.meta.env.BASE_URL + path, location.origin).href;
}
