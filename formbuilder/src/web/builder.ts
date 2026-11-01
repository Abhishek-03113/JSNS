/* New quiz: read a paper, check the answers, make the Google Form. */
import { readDocx } from "./lib/docx.ts";
import { EXAMPLE_NAME, EXAMPLE_PAPER } from "./lib/example.ts";
import {
  buildPayload,
  defaultSettings,
  docxToLines,
  isQuestion,
  isSection,
  needsLook,
  parse,
  parseText,
  splitLines,
  type FlagType,
  type FormSettings,
  type Question,
  type QuizModel,
} from "./lib/mcq.ts";
import { $, api, ApiError, el, ICON, initShell, linkRow, plural, toast, type Me } from "./lib/ui.ts";

interface MadeForm {
  title: string;
  status: string;
  error: string | null;
  questionCount: number;
  editUrl: string | null;
  studentUrl: string | null;
  publishedUrl: string | null;
}

const state = {
  model: null as QuizModel | null,
  fileName: "",
  example: false,
  filter: "all" as "all" | "flag",
  editing: new Set<number>(),
  making: false,
};
let me: Me | null = null;

const CHIP: Partial<Record<FlagType, string>> = {
  conflict: "Key vs *",
  noanswer: "No answer",
  dupe: "Repeated option",
  few: "Too few options",
  odd: "Odd characters",
};

const questions = () => (state.model ? state.model.items.filter(isQuestion) : []);
const optName = (q: Question, i: number) => (q.options[i] ? q.options[i]!.label + ") " + q.options[i]!.text : "");

function noteFor(q: Question, t: FlagType, alt?: number, texts?: string[]): string | null {
  if (t === "conflict") return `Key says ${optName(q, q.answer)}, paper marks ${optName(q, alt ?? -1)}`;
  if (t === "noanswer") return q.answer < 0 ? "Pick the correct option" : null;
  if (t === "dupe") return "Removed repeated " + (texts || []).join(", ");
  if (t === "few") return "Fewer than two options. Edit to fix";
  if (t === "odd") return "Characters from another script. Check the spelling";
  return null;
}

/* Loading a paper */

function setStatus(text: string | null) {
  const s = $("status");
  s.textContent = text || "";
  s.hidden = !text;
}

function showDrop(open: boolean) {
  $("drop").hidden = !open;
  $("drop-cancel").hidden = !state.model;
  if (!open) $("paste").hidden = true;
}

function loadModel(model: QuizModel, name: string, example: boolean) {
  if (!model.items.some(isQuestion)) {
    setStatus(`No questions found in ${name}. Number each question (1. or Q1.) and label options A) to D)`);
    return;
  }
  setStatus(null);
  state.model = model;
  state.fileName = name;
  state.example = example;
  state.editing.clear();
  state.filter = "all";
  const st = defaultSettings(model, name.replace(/\.[^.]+$/, ""));
  $<HTMLInputElement>("s-title").value = st.title;
  $<HTMLTextAreaElement>("s-desc").value = st.description;
  $<HTMLTextAreaElement>("s-confirm").value = st.confirm;
  $("file-name").textContent = name;
  $("example-tag").hidden = !example;
  $("paper").hidden = false;
  $("review").hidden = false;
  $("made").hidden = true;
  showDrop(false);
  renderAll();
}

async function readFile(file: File) {
  const name = file.name || "paper";
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return setStatus("PDFs can't be read. Save it as .docx, or paste the text");
  if (ext === "doc") return setStatus("Old .doc files can't be read. Save it as .docx");
  try {
    if (ext === "docx") {
      const doc = await readDocx(file);
      if (!doc) return setStatus(`${name} isn't a Word document. Save it again as .docx`);
      loadModel(parse(docxToLines(doc)), name, false);
    } else loadModel(parse(splitLines(await file.text())), name, false);
  } catch {
    setStatus(`${name} couldn't be read. Try Paste text`);
  }
}

/* Review list */

function renderMeta() {
  const qs = questions();
  const flagged = qs.filter(needsLook).length;
  $("tab-all").textContent = "All " + qs.length;
  $("tab-flag").textContent = "Needs a look " + flagged;
  $("tab-all").setAttribute("aria-selected", String(state.filter === "all"));
  $("tab-flag").setAttribute("aria-selected", String(state.filter === "flag"));
  const pts = Math.max(0, Math.floor(Number($<HTMLInputElement>("s-points").value)) || 0);
  $("review-meta").textContent = plural(qs.length * pts, "mark", "marks");
  $("suggest").hidden = !me?.features.answerSuggestions || !qs.some((q) => q.answer < 0);
}

function renderCard(q: Question, idx: number, no: number): HTMLElement {
  const flagged = needsLook(q);
  const card = el("article", "q" + (flagged ? " flagged" : ""));
  card.id = "q-" + idx;
  const head = el("div", "q-head");
  head.append(el("span", "q-num", String(no)));
  head.append(el("span", "spacer"));
  if (!q.reviewed) for (const f of q.flags) if (CHIP[f.t]) head.append(el("span", "chip warn", CHIP[f.t]));
  if (!state.editing.has(idx)) {
    const edit = el("button", "text-btn", "Edit");
    edit.type = "button";
    edit.setAttribute("aria-label", "Edit question " + no);
    edit.onclick = () => {
      state.editing.add(idx);
      renderList();
    };
    head.append(edit);
  }
  card.append(head);

  if (state.editing.has(idx)) {
    const ta = el("textarea", "edit-field");
    ta.value = q.q;
    ta.setAttribute("aria-label", "Question text");
    ta.oninput = () => (q.q = ta.value);
    card.append(ta);
    q.options.forEach((o) => {
      const row = el("div", "edit-opt");
      const inp = el("input", "edit-field");
      inp.type = "text";
      inp.value = o.text;
      inp.setAttribute("aria-label", "Option " + o.label);
      inp.oninput = () => (o.text = inp.value);
      row.append(el("span", "lbl", o.label), inp);
      card.append(row);
    });
    const foot = el("div", "q-foot");
    const doneBtn = el("button", "btn btn-secondary", "Done");
    doneBtn.type = "button";
    doneBtn.onclick = () => {
      q.options = q.options.filter((o, oi) => {
        const keep = o.text.trim() !== "";
        if (!keep && q.answer === oi) q.answer = -1;
        return keep;
      });
      q.flags = q.flags.filter((f) => f.t !== "odd" && f.t !== "dupe" && !(f.t === "few" && q.options.length >= 2));
      state.editing.delete(idx);
      renderAll();
    };
    const add = el("button", "text-btn", "Add option");
    add.type = "button";
    add.onclick = () => {
      const used = q.options.map((o) => o.label);
      const set = [["A", "B", "C", "D", "E", "F"], ["a", "b", "c", "d", "e", "f"], ["अ", "ब", "क", "ड", "इ"]].find((s) => used.every((u) => s.includes(u))) || ["A", "B", "C", "D", "E", "F"];
      q.options.push({ label: set.find((l) => !used.includes(l)) || String(q.options.length + 1), text: "" });
      renderList();
    };
    foot.append(doneBtn, add);
    card.append(foot);
    return card;
  }

  card.append(el("p", "q-text", q.q));
  if (q.word) {
    const w = el("p", "q-word", "Underlined: ");
    w.append(el("b", undefined, q.word));
    card.append(w);
  }
  const alt = q.flags.find((f) => f.t === "conflict")?.alt;
  const opts = el("div", "opts");
  q.options.forEach((o, oi) => {
    const b = el("button", "opt" + (oi === q.answer ? " is-correct" : "") + (!q.reviewed && oi === alt ? " is-alt" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(oi === q.answer));
    b.append(el("span", "lbl", o.label), el("span", "otext", o.text));
    b.insertAdjacentHTML("beforeend", ICON.tick);
    b.onclick = () => {
      q.answer = oi;
      q.reviewed = true;
      q.source = "you";
      q.flags = q.flags.filter((f) => !["noanswer", "conflict"].includes(f.t));
      renderAll(idx);
    };
    opts.append(b);
  });
  card.append(opts);

  if (!q.reviewed) {
    for (const f of q.flags) {
      const n = noteFor(q, f.t, f.alt, f.texts);
      if (n) card.append(el("div", "note", n));
    }
  }
  if (flagged && q.answer >= 0) {
    const foot = el("div", "q-foot");
    const ok = el("button", "btn btn-secondary", "Looks right");
    ok.type = "button";
    ok.onclick = () => {
      q.reviewed = true;
      renderAll(idx);
    };
    foot.append(ok);
    card.append(foot);
  }
  return card;
}

function renderList(focusIdx?: number) {
  const list = $("list");
  const keep = list.scrollTop;
  list.textContent = "";
  if (!state.model) return;
  let no = 0;
  let shown = 0;
  state.model.items.forEach((it, idx) => {
    if (isSection(it)) {
      if (state.filter !== "all") return;
      const row = el("div", "sec-row");
      row.append(el("h3", undefined, it.section));
      if (it.help) row.append(el("p", undefined, it.help));
      list.append(row);
      return;
    }
    no++;
    if (state.filter === "flag" && !needsLook(it)) return;
    list.append(renderCard(it, idx, no));
    shown++;
  });
  if (!shown) list.append(el("div", "empty", state.filter === "flag" ? "Nothing needs a look" : "No questions"));
  list.scrollTop = keep;
  if (focusIdx != null) $("q-" + focusIdx)?.querySelector<HTMLElement>(".opt.is-correct")?.focus({ preventScroll: true });
}

/* Form panel */

function settings(): FormSettings {
  return {
    title: $<HTMLInputElement>("s-title").value,
    description: $<HTMLTextAreaElement>("s-desc").value,
    points: Number($<HTMLInputElement>("s-points").value),
    confirm: $<HTMLTextAreaElement>("s-confirm").value,
    student: $<HTMLInputElement>("s-student").checked,
    keepLetters: $<HTMLInputElement>("s-letters").checked,
    headings: $<HTMLInputElement>("s-headings").checked,
    pages: $<HTMLInputElement>("s-pages").checked,
    shuffle: $<HTMLInputElement>("s-shuffle").checked,
  };
}

function renderSide() {
  const qs = questions();
  const noAns = qs.filter((q) => q.answer < 0).length;
  const warn = $("warn");
  let text = "";
  if (me && (me.google.missingScopes.length || !me.google.connected)) text = "Google Forms access is missing. Sign out and sign in again";
  else if (me && !me.executorConfigured) text = "Form making isn't set up on the server yet";
  else if (noAns) text = plural(noAns, "question has", "questions have") + " no answer and will score 0";
  warn.textContent = text;
  warn.hidden = !text;
  const make = $<HTMLButtonElement>("make");
  make.disabled = state.making || !qs.length;
  make.textContent = state.making ? "Making form…" : "Make form";
}

function renderAll(focusIdx?: number) {
  renderMeta();
  renderList(focusIdx);
  renderSide();
}

function makeStatus(text: string | null) {
  const s = $("make-status");
  s.textContent = text || "";
  s.hidden = !text;
  s.classList.toggle("error", !!text);
}

function showMade(f: MadeForm) {
  const box = $("made");
  box.textContent = "";
  const head = el("div", "made-head");
  head.insertAdjacentHTML("beforeend", ICON.tick);
  head.append(el("span", undefined, "Form made"));
  box.append(head, linkRow("Edit", f.editUrl), linkRow("Students", f.studentUrl || f.publishedUrl));
  box.hidden = false;
}

async function make() {
  if (!state.model || state.making) return;
  state.making = true;
  makeStatus(null);
  $("made").hidden = true;
  renderSide();
  try {
    const r = await api<{ form: MadeForm }>("POST", "/api/forms", { payload: buildPayload(state.model, settings()), source: "app" });
    showMade(r.form);
    toast("Form made");
  } catch (e) {
    const err = e as ApiError;
    const invalid = (err.details as { errors?: string[] } | undefined)?.errors;
    makeStatus(invalid?.length ? invalid[0]! : err.message);
  } finally {
    state.making = false;
    renderSide();
  }
}

/* Optional: answer suggestions from a configured provider (off until the server has one) */

async function suggest() {
  if (!state.model) return;
  const b = $<HTMLButtonElement>("suggest");
  b.disabled = true;
  b.textContent = "Suggesting…";
  try {
    const items = questions()
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => q.answer < 0);
    const r = await api<{ answers: { index: number; answer: number }[] }>("POST", "/api/answers/suggest", {
      questions: items.map(({ q, i }) => ({ index: i, question: q.q, options: q.options.map((o) => o.text), word: q.word || undefined })),
    });
    const qs = questions();
    for (const a of r.answers) {
      const q = qs[a.index];
      if (q && q.answer < 0 && a.answer >= 0 && a.answer < q.options.length) {
        q.answer = a.answer;
        q.flags = q.flags.filter((f) => f.t !== "noanswer");
      }
    }
    renderAll();
  } catch (e) {
    toast((e as Error).message);
  } finally {
    b.disabled = false;
    b.textContent = "Suggest answers";
  }
}

/* Wiring */

$("pick").onclick = () => $("file").click();
$<HTMLInputElement>("file").onchange = function () {
  const f = (this as HTMLInputElement).files?.[0];
  if (f) readFile(f);
  (this as HTMLInputElement).value = "";
};
$("replace").onclick = () => showDrop(true);
$("drop-cancel").onclick = () => showDrop(false);
$("paste-open").onclick = () => {
  $("paste").hidden = false;
  $<HTMLTextAreaElement>("paste-text").focus();
};
$("paste-cancel").onclick = () => ($("paste").hidden = true);
$("paste-go").onclick = () => {
  const t = $<HTMLTextAreaElement>("paste-text").value;
  if (!t.trim()) return setStatus("Paste the paper text first");
  loadModel(parseText(t), "Pasted text", false);
};
const drop = $("drop");
for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add("over")));
for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.remove("over")));
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = (e as DragEvent).dataTransfer?.files[0];
  if (f) readFile(f);
});
$("tab-all").onclick = () => ((state.filter = "all"), renderAll());
$("tab-flag").onclick = () => ((state.filter = "flag"), renderAll());
$("make").onclick = make;
$("suggest").onclick = suggest;
for (const id of ["s-points"]) $(id).addEventListener("input", renderMeta);

loadModel(parseText(EXAMPLE_PAPER), EXAMPLE_NAME, true);
initShell()
  .then((m) => {
    me = m;
    renderAll();
  })
  .catch(() => {});
