/**
 * Error pages for people in a browser. API, MCP and OAuth clients get JSON instead (see wantsHtml).
 * Styles are inlined so the page renders even when the app itself failed to start.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface ErrorPageAction {
  label: string;
  href: string;
  primary?: boolean;
}

export interface ErrorPageOptions {
  status: number;
  title: string;
  soft: string;
  message: string;
  actions?: ErrorPageAction[];
  /** Shown small at the bottom, e.g. a reference to quote when asking for help. */
  reference?: string;
}

export function errorPage(o: ErrorPageOptions): Response {
  const actions = (o.actions ?? [{ label: "Go to your forms", href: "/", primary: true }])
    .map((a) => `<a class="btn ${a.primary ? "btn-primary" : "btn-grey"}" href="${esc(a.href)}">${esc(a.label)}</a>`)
    .join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)} · MCQ Form Builder</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@500&family=Inter:wght@400;500&display=swap">
<style>
:root { --ground:#f8f8f8; --card:#efefef; --paper:#fffffd; --ink:#0f100d; --ink-button:#181614; --ink-title:#2b2b29; --ink-body:#6c6d6a; --ink-faint:#939393; --grey-button:#e6e6e4; --line:#e5e6e3;
  --serif:"EB Garamond", Garamond, "Times New Roman", serif; --sans:"Inter", -apple-system, system-ui, sans-serif; color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--ground); color: var(--ink-title); font: 400 14px/21px var(--sans); -webkit-font-smoothing: antialiased; }
.wrap { max-width: 896px; margin: 0 auto; padding: 0 max(16px, env(safe-area-inset-left, 0px)) 48px; display: flex; flex-direction: column; gap: 48px; }
@media (min-width: 720px) { .wrap { padding-left: 32px; padding-right: 32px; } }
.bar { display: flex; align-items: center; gap: 10px; padding-block: 18px; font: 500 13px/20px var(--sans); color: var(--ink); text-decoration: none; }
.head { display: flex; flex-direction: column; gap: 14px; max-width: 620px; }
h1 { margin: 0; font: 500 40px/44px var(--serif); letter-spacing: -0.02em; color: var(--ink); text-wrap: balance; }
h1 span { display: block; color: var(--ink-faint); }
@media (max-width: 480px) { h1 { font-size: 34px; line-height: 38px; } }
p { margin: 0; color: var(--ink-body); max-width: 60ch; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn { display: inline-flex; align-items: center; min-height: 36px; padding: 0 14px; border-radius: 8px; font: 500 13px/20px var(--sans); text-decoration: none; }
.btn-primary { background: var(--ink-button); color: var(--paper); }
.btn-grey { background: var(--grey-button); color: var(--ink-title); }
.ref { font: 400 12px/19px var(--sans); color: var(--ink-faint); border-top: 1px solid var(--line); padding-top: 18px; }
</style></head>
<body><div class="wrap">
  <a class="bar" href="/"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="1" y="1" width="20" height="20" rx="6" fill="#181614"/><circle cx="7" cy="8" r="1.8" fill="none" stroke="#fffffd" stroke-width="1.3"/><circle cx="7" cy="14" r="1.8" fill="#4078e8"/><rect x="11" y="7.3" width="6" height="1.4" rx=".7" fill="#fffffd"/><rect x="11" y="13.3" width="6" height="1.4" rx=".7" fill="#fffffd"/></svg>MCQ Form Builder</a>
  <div class="head">
    <h1>${esc(o.title)}<span>${esc(o.soft)}</span></h1>
    <p>${esc(o.message)}</p>
    <div class="actions">${actions}</div>
  </div>
  ${o.reference ? `<div class="ref">Reference: ${esc(o.reference)}</div>` : ""}
</div></body></html>`;
  return new Response(html, { status: o.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** Paths whose callers are programs (API, MCP, OAuth): they always get JSON. */
export function isMachinePath(path: string): boolean {
  return (
    path.startsWith("/api/") ||
    path === "/mcp" ||
    path.startsWith("/.well-known/") ||
    path === "/healthz" ||
    path.startsWith("/assets/") ||
    ["/oauth/token", "/oauth/register", "/oauth/revoke"].includes(path)
  );
}

/** A person in a browser asked for a page. */
export function wantsHtml(req: Request): boolean {
  return !isMachinePath(new URL(req.url).pathname);
}

export const PAGES = {
  notFound: () =>
    errorPage({ status: 404, title: "Page not found.", soft: "Nothing lives at this address.", message: "The link may be old or mistyped. Your forms are on the dashboard." }),
  serverError: (reference?: string) =>
    errorPage({
      status: 500,
      title: "Something broke.",
      soft: "It's on our side, not yours.",
      message: "The request couldn't be finished. Try again; if it keeps happening, sign in again or come back in a few minutes.",
      actions: [
        { label: "Try again", href: "", primary: true },
        { label: "Go to your forms", href: "/" },
      ],
      reference,
    }),
  databaseUnavailable: () =>
    errorPage({
      status: 503,
      title: "Can't reach the database.",
      soft: "Usually this clears up in a moment.",
      message: "The app couldn't connect to its database just now, so nothing was changed. Wait a few seconds and try again.",
      actions: [{ label: "Try again", href: "", primary: true }],
    }),
  notSetUp: () =>
    errorPage({
      status: 503,
      title: "Not set up yet.",
      soft: "The app is missing its settings.",
      message: "Whoever runs MCQ Form Builder still needs to add its Google and database settings. Once they do, this page works without any change on your side.",
      actions: [{ label: "Try again", href: "", primary: true }],
    }),
};
