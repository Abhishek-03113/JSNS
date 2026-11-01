/* Forms: what's been made, with the two links and the questions. Read-only. */
import type { PayloadItem } from "../mcq/script.ts";
import { $, api, el, ICON, initShell, linkRow, plural, toast, when } from "./lib/ui.ts";

interface FormItem {
  id: string;
  title: string;
  status: "pending" | "created" | "failed";
  error: string | null;
  source: string;
  questionCount: number;
  unansweredCount: number;
  editUrl: string | null;
  studentUrl: string | null;
  publishedUrl: string | null;
  responseCount: number | null;
  acceptingResponses: boolean | null;
  createdAt: string;
}

const state = {
  forms: [] as FormItem[],
  filter: "all" as "all" | "created" | "failed",
  open: null as { id: string; items: PayloadItem[] } | null,
};

const LETTERS = "ABCDEFGHIJ";
function splitOption(opt: string, i: number) {
  const m = opt.match(/^\s*\(?([A-Za-z]|अ|ब|क|ड|स|द|इ)\)\s+(.*)$/s);
  return m ? { label: m[1]!, text: m[2]! } : { label: LETTERS[i] || String(i + 1), text: opt };
}

function questionsBox(items: PayloadItem[]): HTMLElement {
  const box = el("div", "qscroll small");
  box.tabIndex = 0;
  box.setAttribute("aria-label", "Questions and answers");
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
    const head = el("div", "q-head");
    head.append(el("span", "q-num", String(no)), el("span", "spacer"));
    if (it.answer < 0) head.append(el("span", "chip warn", "No answer"));
    card.append(head, el("p", "q-text", it.q));
    if (it.word) {
      const w = el("p", "q-word", "Underlined: ");
      w.append(el("b", undefined, it.word));
      card.append(w);
    }
    const opts = el("div", "opts");
    it.options.forEach((o, oi) => {
      const { label, text } = splitOption(o, oi);
      const d = el("div", "opt static" + (oi === it.answer ? " is-correct" : ""));
      d.append(el("span", "lbl", label), el("span", "otext", text));
      d.insertAdjacentHTML("beforeend", ICON.tick);
      opts.append(d);
    });
    card.append(opts);
    box.append(card);
  }
  return box;
}

function renderStats() {
  const made = state.forms.filter((f) => f.status === "created");
  const failed = state.forms.filter((f) => f.status === "failed").length;
  $("st-forms").textContent = String(made.length);
  $("st-questions").textContent = String(made.reduce((n, f) => n + f.questionCount, 0));
  $("st-responses").textContent = String(made.reduce((n, f) => n + (f.responseCount ?? 0), 0));
  $("tab-all").textContent = "All " + state.forms.length;
  $("tab-created").textContent = "Made " + made.length;
  $("tab-failed").textContent = "Failed " + failed;
  $("tab-failed").hidden = !failed && state.filter !== "failed";
  for (const k of ["all", "created", "failed"] as const) $("tab-" + k).setAttribute("aria-selected", String(state.filter === k));
}

function renderForm(f: FormItem): HTMLElement {
  const row = el("article", "form-row" + (f.status === "failed" ? " failed" : ""));
  const head = el("div", "form-head");
  const title = el("div", "form-title");
  title.append(el("h3", undefined, f.title));
  const meta = [plural(f.questionCount, "question", "questions"), when(f.createdAt)];
  if (f.status === "created") meta.push(plural(f.responseCount ?? 0, "response", "responses"));
  title.append(el("span", "muted num", meta.join(" · ")));
  head.append(title);
  if (f.status === "created") {
    if (f.acceptingResponses === false) head.append(el("span", "chip", "Closed"));
  } else head.append(el("span", "chip warn", f.status === "failed" ? "Failed" : "Making"));
  row.append(head);

  if (f.status === "created") {
    const links = el("div", "links");
    links.append(linkRow("Edit", f.editUrl), linkRow("Students", f.studentUrl || f.publishedUrl));
    row.append(links);
  } else if (f.error) row.append(el("div", "note", f.error));

  const open = state.open?.id === f.id;
  const toggle = el("button", "text-btn", open ? "Hide questions" : "Questions");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", String(open));
  toggle.onclick = async () => {
    if (open) state.open = null;
    else {
      try {
        const r = await api<{ form: { payload: { items: PayloadItem[] } } }>("GET", "/api/forms/" + f.id);
        state.open = { id: f.id, items: r.form.payload.items };
      } catch (e) {
        return toast((e as Error).message);
      }
    }
    renderList();
  };
  row.append(toggle);
  if (open) row.append(questionsBox(state.open!.items));
  return row;
}

function renderList() {
  const list = $("list");
  list.textContent = "";
  const shown = state.forms.filter((f) => state.filter === "all" || f.status === state.filter);
  if (!shown.length) {
    const empty = el("div", "empty");
    if (state.forms.length) empty.textContent = "Nothing here";
    else {
      empty.append("No forms yet. ");
      const a = el("a", undefined, "Make one");
      a.href = "/";
      empty.append(a);
    }
    list.append(empty);
  } else shown.forEach((f) => list.append(renderForm(f)));
}

function render() {
  renderStats();
  renderList();
}

for (const k of ["all", "created", "failed"] as const) $("tab-" + k).onclick = () => ((state.filter = k), render());

$("refresh").onclick = async () => {
  const b = $<HTMLButtonElement>("refresh");
  b.disabled = true;
  b.textContent = "Refreshing…";
  try {
    const r = await api<{ forms: FormItem[]; unavailable: string[] }>("POST", "/api/forms/stats");
    state.forms = r.forms;
    render();
    toast(r.unavailable.length ? plural(r.unavailable.length, "form", "forms") + " couldn't be opened" : "Responses updated");
  } catch (e) {
    toast((e as Error).message);
  } finally {
    b.disabled = false;
    b.textContent = "Refresh responses";
  }
};

// Who is signed in and the list load together, not one after the other.
Promise.all([initShell(), api<{ forms: FormItem[] }>("GET", "/api/forms?limit=200")])
  .then(([, r]) => {
    state.forms = r.forms;
    render();
  })
  .catch((e) => toast((e as Error).message));
