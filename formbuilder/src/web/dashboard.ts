/* Dashboard: lists the forms the API made for this user, response counts, scripts and API tokens. */

interface FormItem {
  id: string;
  title: string;
  description: string;
  status: "pending" | "created" | "failed";
  error: string | null;
  source: string;
  questionCount: number;
  unansweredCount: number;
  formId: string | null;
  editUrl: string | null;
  publishedUrl: string | null;
  studentUrl: string | null;
  responsesUrl: string | null;
  responseCount: number | null;
  acceptingResponses: boolean | null;
  statsUpdatedAt: string | null;
  scriptEditUrl: string | null;
  createdAt: string;
}

type PayloadItem = { section: string; help?: string } | { q: string; options: string[]; answer: number; word?: string };

interface TokenItem {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface Me {
  user: { email: string; name: string; picture: string };
  google: { connected: boolean; missingScopes: string[] };
  executorConfigured: boolean;
}

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 401) {
    location.href = "/login?return_to=/";
    throw new ApiError(401, "unauthenticated", "Signed out");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || "error", data?.error?.message || "Request failed (" + res.status + ").");
  return data as T;
}

let toastTimer = 0;
function toast(msg: string) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 2600);
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast("Couldn't copy. Select the text and press Ctrl+C.");
  }
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const when = (iso: string) => dateFmt.format(new Date(iso));
const plural = (n: number, one: string, many: string) => n + " " + (n === 1 ? one : many);

const state = {
  forms: [] as FormItem[],
  filter: "all" as "all" | "created" | "failed",
  openQuestions: {} as Record<string, PayloadItem[]>,
  busy: {} as Record<string, boolean>,
};

/* Summary + list */

function renderSummary() {
  const made = state.forms.filter((f) => f.status === "created");
  const failed = state.forms.filter((f) => f.status === "failed").length;
  const responses = made.reduce((n, f) => n + (f.responseCount ?? 0), 0);
  const questions = made.reduce((n, f) => n + f.questionCount, 0);
  $("forms-soft").textContent = made.length ? plural(made.length, "form", "forms") + " made so far." : "None made yet.";
  const s = $("summary");
  s.textContent = "";
  const add = (n: number, label: string) => {
    const sp = el("span");
    sp.append(el("b", undefined, String(n)), " " + label);
    s.append(sp);
  };
  add(made.length, made.length === 1 ? "form" : "forms");
  add(questions, questions === 1 ? "question" : "questions");
  add(responses, responses === 1 ? "response" : "responses");
  if (failed) add(failed, "failed");
  $("tab-all").textContent = "All " + state.forms.length;
  $("tab-created").textContent = "Made " + made.length;
  $("tab-failed").textContent = "Failed " + failed;
  for (const k of ["all", "created", "failed"] as const) $("tab-" + k).setAttribute("aria-selected", String(state.filter === k));
}

const isHttps = (u: string | null): u is string => !!u && /^https:\/\//.test(u);

/** One of the two links the script returns: the URL itself is clickable, with copy and open-in-new-tab. */
function linkRow(label: string, hint: string, url: string | null): HTMLElement {
  const row = el("div", "linkrow");
  const text = el("div", "linkrow-text");
  text.append(el("span", "linkrow-label", label));
  if (isHttps(url)) {
    const a = el("a", "linkrow-url", url.replace(/^https:\/\//, ""));
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.title = url;
    text.append(a);
  } else text.append(el("span", "linkrow-hint", "Not available"));
  text.append(el("span", "linkrow-hint", hint));
  row.append(text);
  const acts = el("div", "linkrow-actions");
  const b = (name: string, cls: string, fn: () => void) => {
    const btn = el("button", "btn " + cls, name);
    btn.type = "button";
    btn.disabled = !isHttps(url);
    btn.setAttribute("aria-label", name + " " + label.toLowerCase());
    btn.onclick = fn;
    acts.append(btn);
  };
  b("Copy", "btn-grey", () => copy(url!, label + " copied."));
  if (isHttps(url)) {
    const open = el("a", "btn btn-primary", "Open in new tab");
    open.href = url;
    open.target = "_blank";
    open.rel = "noopener";
    open.setAttribute("aria-label", "Open " + label.toLowerCase() + " in a new tab");
    acts.append(open);
  }
  row.append(acts);
  return row;
}

function statusChip(f: FormItem) {
  if (f.status === "created") return el("span", "chip ok", "Made");
  if (f.status === "failed") return el("span", "chip warn", "Failed");
  return el("span", "chip wait", "Running");
}

const TICK =
  '<svg class="tick" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="9" fill="#4078e8"/><path d="M5 9.3l2.6 2.5L13 6.5" fill="none" stroke="#fffffd" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LETTERS = "ABCDEFGHIJ";

/** Options are stored as sent, e.g. "B) They walk" when the builder kept letters. Split the label back out. */
function splitOption(opt: string, i: number): { label: string; text: string } {
  const m = opt.match(/^\s*\(?([A-Za-z]|अ|ब|क|ड|स|द|इ)\)\s+(.*)$/s);
  return m ? { label: m[1]!, text: m[2]! } : { label: LETTERS[i] || String(i + 1), text: opt };
}

/** Read-only version of the artifact's "Check the answers" list, scrolling inside the form card. */
function renderQuestions(f: FormItem, items: PayloadItem[]): HTMLElement {
  const wrap = el("div", "qbox");
  const total = items.filter((i) => "q" in i).length;
  const missing = items.filter((i) => "q" in i && i.answer < 0).length;
  const head = el("div", "qbox-head");
  const count = el("span");
  count.append(el("b", undefined, String(total)), " " + (total === 1 ? "question" : "questions") + (missing ? ", " + missing + " without an answer" : ""));
  head.append(count, el("span", undefined, total > 2 ? "Scroll for more" : ""));
  const box = el("div", "qscroll");
  box.tabIndex = 0;
  wrap.append(head, box);
  box.setAttribute("aria-label", "Questions and answers in " + f.title);
  let no = 0;
  for (const it of items) {
    if ("section" in it) {
      const row = el("div", "sec-row");
      row.append(el("h3", undefined, it.section));
      if (it.help) row.append(el("p", undefined, it.help));
      box.append(row);
      continue;
    }
    no++;
    const card = el("article", "q" + (it.answer < 0 ? " flagged" : ""));
    const head = el("div", "qhead");
    head.append(el("span", "qnum", String(no)), el("span", "spacer"));
    if (it.answer < 0) head.append(el("span", "chip warn", "No answer"));
    card.append(head, el("p", "qtext", it.q));
    if (it.word) {
      const w = el("p", "qword", "Underlined word: ");
      w.append(el("b", undefined, it.word));
      card.append(w);
    }
    const opts = el("div", "opts");
    it.options.forEach((o, oi) => {
      const { label, text } = splitOption(o, oi);
      const correct = oi === it.answer;
      const d = el("div", "opt" + (correct ? " is-correct" : ""));
      d.setAttribute("aria-label", "Option " + label + ": " + text + (correct ? ", correct answer" : ""));
      d.append(el("span", "lbl", label), el("span", "otext", text));
      d.insertAdjacentHTML("beforeend", TICK);
      opts.append(d);
    });
    card.append(opts);
    if (it.answer < 0) {
      const n = el("div", "note");
      n.append(el("span", undefined, "No correct answer was set, so this question scores 0 for everyone."));
      card.append(n);
    }
    box.append(card);
  }
  return wrap;
}

function renderForm(f: FormItem): HTMLElement {
  const card = el("article", "form" + (f.status === "failed" ? " failed" : ""));
  card.id = "form-" + f.id;

  const head = el("div", "fhead");
  const t = el("div", "ftitle");
  t.append(el("h3", undefined, f.title));
  const meta = [plural(f.questionCount, "question", "questions"), "made " + when(f.createdAt)];
  if (f.source && f.source !== "dashboard") meta.push("from " + f.source);
  t.append(el("span", "fmeta", meta.join(" · ")));
  head.append(t);
  const chips = el("div", "fchips");
  chips.append(statusChip(f));
  if (f.unansweredCount) chips.append(el("span", "chip warn", plural(f.unansweredCount, "without answer", "without answers")));
  if (f.status === "created" && f.acceptingResponses === false) chips.append(el("span", "chip", "Closed"));
  head.append(chips);
  card.append(head);

  if (f.status === "created") {
    const stats = el("div", "stats");
    const stat = (value: string, label: string) => {
      const d = el("div", "stat");
      d.append(el("b", undefined, value), el("span", undefined, label));
      stats.append(d);
    };
    stat(f.responseCount == null ? "–" : String(f.responseCount), f.statsUpdatedAt ? "Responses, as of " + when(f.statsUpdatedAt) : "Responses");
    stat(String(f.questionCount), "Questions");
    stat(f.acceptingResponses === false ? "Closed" : "Open", "Accepting responses");
    card.append(stats);
    const links = el("div", "linkrows");
    links.append(
      linkRow("Edit link", "For you: change questions, settings and see responses.", f.editUrl),
      linkRow("Student link", "Send this to students to take the quiz.", f.studentUrl || f.publishedUrl),
    );
    card.append(links);
  } else if (f.status === "failed" && f.error) {
    const n = el("div", "note");
    n.append(el("span", undefined, f.error));
    card.append(n);
  }

  const qs = state.openQuestions[f.id];
  if (qs) card.append(renderQuestions(f, qs));

  const foot = el("div", "ffoot");
  const busy = !!state.busy[f.id];
  const btn = (label: string, cls: string, fn: () => void) => {
    const b = el("button", cls, label);
    b.type = "button";
    b.disabled = busy;
    b.onclick = fn;
    foot.append(b);
    return b;
  };
  if (f.status === "failed") btn(busy ? "Running..." : "Try again", "btn btn-paper", () => retry(f));
  btn(qs ? "Hide questions" : "Show questions and answers", "link", () => toggleQuestions(f));
  btn("Remove from list", "link danger", () => removeForm(f));
  card.append(foot);
  return card;
}

function renderList() {
  const list = $("list");
  list.textContent = "";
  const shown = state.forms.filter((f) => state.filter === "all" || f.status === state.filter);
  if (!shown.length) {
    const msg =
      state.filter === "failed"
        ? "Nothing failed. Every request made its form."
        : state.forms.length
          ? "No forms here."
          : "No forms yet. Send a paper from the MCQ Form Builder with an API token, and it will show up here.";
    list.append(el("div", "empty", msg));
  } else shown.forEach((f) => list.append(renderForm(f)));
}

function renderAll() {
  renderSummary();
  renderList();
}

function replaceForm(f: FormItem) {
  const i = state.forms.findIndex((x) => x.id === f.id);
  if (i >= 0) state.forms[i] = f;
  else state.forms.unshift(f);
}

async function loadForms() {
  const r = await api<{ forms: FormItem[]; total: number }>("GET", "/api/forms?limit=200");
  state.forms = r.forms;
  renderAll();
}

async function toggleQuestions(f: FormItem) {
  if (state.openQuestions[f.id]) {
    delete state.openQuestions[f.id];
    renderList();
    return;
  }
  try {
    const r = await api<{ form: { payload: { items: PayloadItem[] } } }>("GET", "/api/forms/" + f.id);
    state.openQuestions = { [f.id]: r.form.payload.items };
    renderList();
  } catch (e) {
    toast((e as Error).message);
  }
}

async function retry(f: FormItem) {
  state.busy[f.id] = true;
  renderList();
  try {
    const r = await api<{ form: FormItem }>("POST", "/api/forms/" + f.id + "/retry");
    replaceForm(r.form);
    toast("Form made.");
  } catch (e) {
    const err = e as ApiError & { form?: FormItem };
    toast(err.message);
    await loadForms();
  } finally {
    delete state.busy[f.id];
    renderAll();
  }
}

async function removeForm(f: FormItem) {
  if (!confirm('Remove "' + f.title + '" from this list? The Google Form itself stays in your Drive.')) return;
  try {
    await api("DELETE", "/api/forms/" + f.id);
    state.forms = state.forms.filter((x) => x.id !== f.id);
    delete state.openQuestions[f.id];
    renderAll();
    toast("Removed from the list.");
  } catch (e) {
    toast((e as Error).message);
  }
}

async function refreshCounts() {
  const st = $("refresh-status");
  const b = $<HTMLButtonElement>("refresh");
  b.disabled = true;
  st.className = "tool-status";
  st.textContent = "Asking Google...";
  try {
    const r = await api<{ updated: number; unavailable: string[]; forms: FormItem[] }>("POST", "/api/forms/stats");
    state.forms = r.forms;
    renderAll();
    st.textContent =
      "Updated " + plural(r.updated, "form", "forms") + "." + (r.unavailable.length ? " " + plural(r.unavailable.length, "form", "forms") + " couldn't be opened." : "");
  } catch (e) {
    st.className = "tool-status error";
    st.textContent = (e as Error).message;
  } finally {
    b.disabled = false;
  }
}

/* Tokens */

async function loadTokens() {
  const r = await api<{ tokens: TokenItem[] }>("GET", "/api/tokens");
  const box = $("tokens");
  box.textContent = "";
  for (const t of r.tokens) {
    const row = el("div", "token");
    row.append(el("code", undefined, t.prefix + "…"), el("span", "grow", t.name));
    row.append(el("span", "when", t.lastUsedAt ? "Used " + when(t.lastUsedAt) : "Never used"));
    const rm = el("button", "link danger", "Revoke");
    rm.type = "button";
    rm.onclick = async () => {
      if (!confirm('Revoke "' + t.name + '"? Anything using it stops working.')) return;
      await api("DELETE", "/api/tokens/" + t.id);
      toast("Token revoked.");
      loadTokens();
    };
    row.append(rm);
    box.append(row);
  }
}

$("token-create").onclick = async () => {
  const name = $<HTMLInputElement>("token-name").value.trim() || "MCQ Form Builder artifact";
  try {
    const r = await api<{ token: string }>("POST", "/api/tokens", { name });
    $("secret-value").textContent = r.token;
    $("secret").hidden = false;
    $<HTMLInputElement>("token-name").value = "";
    renderCurl(r.token);
    loadTokens();
  } catch (e) {
    toast((e as Error).message);
  }
};
$("secret-copy").onclick = () => copy($("secret-value").textContent || "", "Token copied.");
$("secret-hide").onclick = () => {
  $("secret").hidden = true;
  $("secret-value").textContent = "";
  renderCurl();
};

function renderCurl(token?: string) {
  const body = {
    payload: {
      title: "Std 6 Tense Quiz",
      description: "",
      points: 1,
      student: true,
      pages: false,
      shuffle: false,
      confirm: "Your answers have been submitted.",
      nameLabel: "Student Name",
      rollLabel: "Roll No.",
      wordLabel: "Underlined word: ",
      items: [{ q: "Which sentence is in the simple present tense?", options: ["A) She is playing.", "B) They walk to school every day."], answer: 1 }],
    },
  };
  $("curl").textContent =
    "curl -X POST " + location.origin + "/api/forms \\\n" +
    '  -H "Authorization: Bearer ' + (token || "fbk_your_token") + '" \\\n' +
    '  -H "Content-Type: application/json" \\\n' +
    "  -d '" + JSON.stringify(body, null, 2).replace(/'/g, "'\\''") + "'";
}
$("curl-copy").onclick = () => copy($("curl").textContent || "", "Copied.");

/* Claude connector */

async function loadConnections() {
  const r = await api<{ connections: { id: string; name: string; connectedAt: string; lastUsedAt: string | null }[] }>("GET", "/api/connections");
  const box = $("connections");
  box.textContent = "";
  if (!r.connections.length) {
    box.append(el("div", "linkrow-hint", "Nothing connected yet. Follow the steps above to add Claude."));
    return;
  }
  for (const c of r.connections) {
    const row = el("div", "token");
    row.append(el("span", "grow", c.name), el("span", "when", c.lastUsedAt ? "Used " + when(c.lastUsedAt) : "Connected " + when(c.connectedAt)));
    const rm = el("button", "link danger", "Disconnect");
    rm.type = "button";
    rm.onclick = async () => {
      await api("DELETE", "/api/connections/" + c.id);
      toast(c.name + " disconnected. Connect it again from Claude's settings.");
      loadConnections();
    };
    row.append(rm);
    box.append(row);
  }
}
$("mcp-url").textContent = location.origin + "/mcp";
$("mcp-copy").onclick = () => copy(location.origin + "/mcp", "Connector URL copied.");

/* Header + start */

$("logout").onclick = async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  location.href = "/login";
};
for (const k of ["all", "created", "failed"] as const) {
  $("tab-" + k).onclick = () => {
    state.filter = k;
    renderAll();
  };
}
$("refresh").onclick = refreshCounts;

async function start() {
  renderCurl();
  const me = await api<Me>("GET", "/api/me");
  $("email").textContent = me.user.email;
  if (me.user.picture) {
    const img = $<HTMLImageElement>("avatar");
    img.src = me.user.picture;
    img.hidden = false;
  }
  const warn = $("warn");
  if (me.google.missingScopes.length || !me.google.connected) {
    warn.textContent = "Google permission to manage Forms is missing, so new forms will fail. ";
    const a = el("a", undefined, "Sign in again");
    a.href = "/auth/google";
    warn.append(a, " and keep every permission ticked.");
    warn.hidden = false;
  } else if (!me.executorConfigured) {
    warn.textContent = "The executor script isn't set up on the server yet (APPS_SCRIPT_EXECUTOR_ID), so new forms will fail.";
    warn.hidden = false;
  }
  await Promise.all([loadForms(), loadTokens(), loadConnections()]);
}

start().catch((e) => {
  if (!(e instanceof ApiError && e.status === 401)) {
    $("forms-soft").textContent = "Couldn't load.";
    toast((e as Error).message);
  }
});
