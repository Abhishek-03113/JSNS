/* Shared browser helpers for the app pages. */

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Short fallback when the server sends no message: by status family, then common codes. */
export function statusText(status: number): string {
  const byCode: Record<number, string> = {
    400: "That request didn't make sense",
    403: "Not allowed from here",
    404: "No longer there. Reload to see the latest",
    409: "Already done. Reload to see the latest",
    413: "Too large to send",
    429: "Too many requests. Wait a few seconds",
    502: "Google didn't answer properly. Try again",
    503: "Temporarily unavailable. Try again shortly",
    504: "Took too long. Check before trying again",
  };
  if (byCode[status]) return byCode[status]!;
  if (status >= 500) return "Something broke on our side. Try again";
  if (status >= 400) return "That didn't work. Check and try again";
  if (status >= 300) return "Moved. Reload to continue";
  return "Something unexpected happened. Reload the page";
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network", "Can't reach the app. Check your connection");
  }
  if (res.status === 401) {
    location.href = "/";
    throw new ApiError(401, "unauthenticated", "Signed out");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || "error", data?.error?.message || statusText(res.status), data?.error?.details);
  return data as T;
}

let toastTimer = 0;
export function toast(msg: string) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 2400);
}

export async function copy(text: string, done = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast("Couldn't copy. Select it and press Ctrl+C");
  }
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const when = (iso: string) => dateFmt.format(new Date(iso));
export const plural = (n: number, one: string, many: string) => n + " " + (n === 1 ? one : many);

export interface Me {
  user: { email: string; name: string; picture: string };
  google: { connected: boolean; missingScopes: string[] };
  executorConfigured: boolean;
  features: { answerSuggestions: boolean };
}

/** Line icons (lucide shapes, 16px, 1.5 stroke) used across the pages. */
export const ICON = {
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  tick: '<svg class="tick" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="9"/><path d="M5 9.3l2.6 2.5L13 6.5"/></svg>',
};

export function iconButton(icon: keyof typeof ICON, label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "icon-btn");
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = ICON[icon];
  b.onclick = onClick;
  return b;
}

export function iconLink(icon: keyof typeof ICON, label: string, href: string): HTMLAnchorElement {
  const a = el("a", "icon-btn");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.title = label;
  a.setAttribute("aria-label", label);
  a.innerHTML = ICON[icon];
  return a;
}

/** A labelled, clickable link with copy and open-in-new-tab, used for the form's two links. */
export function linkRow(label: string, url: string | null): HTMLElement {
  const row = el("div", "link-row");
  row.append(el("span", "link-label", label));
  if (url && /^https:\/\//.test(url)) {
    const a = el("a", "link-url", url.replace(/^https:\/\//, ""));
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.title = url;
    row.append(a, iconButton("copy", "Copy " + label.toLowerCase(), () => copy(url, label + " copied")), iconLink("open", "Open " + label.toLowerCase(), url));
  } else row.append(el("span", "muted", "Not available"));
  return row;
}

/** Fills the shared header and wires sign out. Returns who is signed in. */
export async function initShell(): Promise<Me> {
  const me = await api<Me>("GET", "/api/me");
  $("account").textContent = me.user.email;
  if (me.user.picture) {
    const img = $<HTMLImageElement>("avatar");
    img.src = me.user.picture;
    img.hidden = false;
  }
  $("signout").onclick = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    location.href = "/";
  };
  return me;
}
