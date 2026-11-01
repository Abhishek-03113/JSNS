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
  const actions = (o.actions ?? [{ label: "Home", href: "/", primary: true }])
    .map((a) => `<a class="btn ${a.primary ? "btn-primary" : "btn-grey"}" href="${esc(a.href)}">${esc(a.label)}</a>`)
    .join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title.replace(/\.$/, ""))} · MCQ Form Builder</title>
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
h1 { margin: 0; font: 500 32px/36px var(--serif); letter-spacing: -0.02em; color: var(--ink); text-wrap: balance; }
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
    <h1>${esc(o.title.replace(/\.$/, ""))}</h1>
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

type Copy = { title: string; soft: string; message: string };

/**
 * Wording by status family, then by the common codes inside each family. 3xx are redirects the
 * browser normally follows on its own; the 3xx copy only shows if a redirect can't be followed.
 */
const FAMILY: Record<"3" | "4" | "5", Copy> = {
  "3": { title: "This page has moved.", soft: "Follow the link to continue.", message: "This address points somewhere else now." },
  "4": { title: "That request didn't work.", soft: "Something about it needs changing.", message: "Check the link or what you entered." },
  "5": { title: "Something broke.", soft: "It's on our side, not yours.", message: "Try again in a moment." },
};

const BY_STATUS: Record<number, Copy> = {
  301: { title: "This page has moved.", soft: "For good.", message: "Update any bookmark to the new address." },
  302: { title: "Taking you somewhere else.", soft: "Just a moment.", message: "Continue if nothing happens." },
  304: { title: "Nothing new here.", soft: "Your copy is up to date.", message: "Nothing changed since your last visit." },
  400: { title: "That request didn't make sense.", soft: "Something in it was malformed.", message: "Go back and try again." },
  401: { title: "Sign in to continue.", soft: "This page needs your Google account.", message: "Your session has ended." },
  403: { title: "You can't do that here.", soft: "Your account doesn't have access.", message: "Not allowed for your account, or the request came from another site." },
  404: { title: "Page not found.", soft: "Nothing lives at this address.", message: "The link may be old or mistyped." },
  405: { title: "Page not found.", soft: "This address doesn't do that.", message: "This address doesn't do that." },
  408: { title: "That took too long.", soft: "The request timed out before it finished.", message: "Check your connection and try again." },
  409: { title: "That clashes with something.", soft: "It already exists or was already done.", message: "Refresh to see the latest." },
  410: { title: "This is gone.", soft: "It was removed for good.", message: "It was removed." },
  413: { title: "That's too large.", soft: "It's over the size limit.", message: "Split it into smaller parts." },
  422: { title: "Some details need fixing.", soft: "The app couldn't use what was sent.", message: "Check what you entered." },
  429: { title: "Too many requests.", soft: "Give it a moment.", message: "Wait a few seconds, then try again." },
  500: FAMILY["5"],
  502: { title: "Google didn't answer properly.", soft: "A service we depend on had a problem.", message: "Try again in a minute." },
  503: { title: "Temporarily unavailable.", soft: "Usually this clears up in a moment.", message: "Nothing was changed. Try again shortly." },
  504: { title: "That took too long.", soft: "A service we depend on didn't answer in time.", message: "Check before trying again." },
};

/** Copy for any status: the specific code if known, otherwise its family. */
export function statusCopy(status: number): Copy {
  if (BY_STATUS[status]) return BY_STATUS[status]!;
  const fam = String(status)[0] as "3" | "4" | "5";
  return FAMILY[fam] ?? FAMILY["5"];
}

/** Default buttons per family: 4xx points somewhere safe, 5xx offers a retry first. */
function familyActions(status: number, location?: string): ErrorPageAction[] {
  if (status >= 300 && status < 400) return [{ label: "Continue", href: location || "/", primary: true }];
  if (status === 401) return [{ label: "Sign in", href: "/login", primary: true }];
  if (status >= 500) return [{ label: "Try again", href: "", primary: true }, { label: "Home", href: "/" }];
  return [{ label: "Home", href: "/", primary: true }];
}

/** A page for any status, with optional specific detail replacing the generic message. */
export function statusPage(status: number, detail?: string, opts: { reference?: string; location?: string } = {}): Response {
  const c = statusCopy(status);
  return errorPage({ status, title: c.title, soft: c.soft, message: detail || c.message, actions: familyActions(status, opts.location), reference: opts.reference });
}

/** One-line message for JSON clients when no specific one exists. */
export function statusMessage(status: number): string {
  const c = statusCopy(status);
  return `${c.title} ${c.message}`;
}

export const PAGES = {
  notFound: () => statusPage(404),
  serverError: (reference?: string) => statusPage(500, undefined, { reference }),
  databaseUnavailable: () =>
    statusPage(503, "Nothing was changed. Try again in a few seconds."),
  notSetUp: () =>
    errorPage({
      status: 503,
      title: "Not set up yet.",
      soft: "The app is missing its settings.",
      message: "The app's settings haven't been added yet.",
      actions: [{ label: "Try again", href: "", primary: true }],
    }),
};
