/**
 * Question paper text -> quiz model -> form payload. Runs in the browser.
 * Ported from the MCQ Form Builder artifact so the app reads papers exactly the way it does:
 * numbered questions (Q1. 1. १. प्रश्न १.), options (A) (b) अ) on one line or many),
 * an answer key at the end, answers marked with * or ✓, section headings, underlined words.
 */
import type { FormPayload, PayloadItem } from "../../mcq/script.ts";

export interface Option {
  label: string;
  text: string;
}

export type FlagType = "conflict" | "noanswer" | "nokey" | "dupe" | "few" | "odd";

export interface Flag {
  t: FlagType;
  alt?: number;
  texts?: string[];
}

export interface Question {
  n: number;
  q: string;
  word: string;
  options: Option[];
  /** Index of the correct option, -1 when not set. */
  answer: number;
  source: "key" | "mark" | "none" | "you";
  flags: Flag[];
  reviewed?: boolean;
}

export interface Section {
  section: string;
  help: string;
}

export type Item = Question | Section;

export interface QuizModel {
  title: string;
  description: string;
  items: Item[];
  keyFound: boolean;
  keyCount: number;
}

export interface FormSettings {
  title: string;
  description: string;
  points: number;
  confirm: string;
  student: boolean;
  keepLetters: boolean;
  headings: boolean;
  pages: boolean;
  shuffle: boolean;
}

export const isSection = (it: Item): it is Section => (it as Section).section !== undefined;
export const isQuestion = (it: Item): it is Question => (it as Question).q !== undefined;

const DEV_DIGITS = "०१२३४५६७८९";
export const LABEL_SETS: string[][] = [
  ["A", "B", "C", "D", "E", "F"],
  ["a", "b", "c", "d", "e", "f"],
  ["अ", "ब", "क", "ड", "इ"],
  ["अ", "ब", "स", "द", "इ"],
];
const LBL = "[A-Fa-f]|अ|ब|क|ड|स|द|इ";
const OPT_START = new RegExp("^(\\*?)\\s*[\\(\\[]?\\s*(" + LBL + ")\\s*[\\)\\]](?:\\s+|$)(.*)$");
const OPT_START_DOT = /^(\*?)\s*([A-Fa-f])\.\s+(.+)$/;
const OPT_SPLIT = new RegExp("\\s+(\\*?)[\\(\\[]?(" + LBL + ")[\\)\\]]\\s+", "g");
const NUM_LINE = /^(?:(Q(?:uestion|ue)?|प्रश्ना|प्रश्न|प्र)\s*\.?\s*)?(\d{1,3})\s*[.):\-]\s*(.+)$/i;
const NUM_LINE_Q = /^(Q(?:uestion|ue)?|प्रश्ना|प्रश्न|प्र)\s*\.?\s*(\d{1,3})\s*[.):\-]?\s+(.+)$/i;
const SECTION = /^(section|part|विभाग|भाग)\s*[-:]?\s*([A-Z]|[IVX]{1,4}|\d{1,2})\b/i;
const KEY_HEAD = /(answer\s*key|answer\s*sheet|answers\s*:?\s*$|उत्तरपत्रिका|उत्तर\s*पत्रिका|उत्तरसूची|उत्तर\s*सूची|उत्तरतालिका)/i;
const SEPARATOR = /^[\s\-_=*~—–•·.]{3,}$/;
const KEY_ITEM = new RegExp(
  "(?:^|[^\\d])(\\d{1,3})\\s*[.):\\-]?\\s*(?:(?:उत्तर|answer|ans)\\s*[:.\\-]?\\s*)?[\\(\\[]?\\s*(" + LBL + ")\\s*(?=[\\)\\].,:;\\s|]|$)",
  "gi",
);
const CORRECT_MARK = /\s*(?:\(\s*correct\s*\)|\[\s*correct\s*\]|✓|✔|✅|\(\s*बरोबर\s*\))\s*/i;
const ODD_SCRIPT = /[぀-ヿ㐀-鿿가-힯Ѐ-ӿ؀-ۿ�]/;

const toAscii = (s: string) => s.replace(/[०-९]/g, (d) => String(DEV_DIGITS.indexOf(d)));
const squash = (s: string) => s.replace(/[ \t ]+/g, " ").trim();
const normKey = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

export function isMarathi(s: string): boolean {
  return /[ऀ-ॿ]/.test(s);
}

/** word/document.xml (parsed) -> lines; underlined runs are wrapped in « » so the parser can find them. */
export function docxToLines(doc: Document): string[] {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const body = doc.getElementsByTagNameNS(W, "body")[0] || doc;
  const paras = body.getElementsByTagNameNS(W, "p");
  const out: string[] = [];
  for (let i = 0; i < paras.length; i++) {
    const runs = paras[i]!.getElementsByTagNameNS(W, "r");
    let text = "";
    let inU = false;
    for (let j = 0; j < runs.length; j++) {
      const r = runs[j]!;
      let u = false;
      const rPr = r.getElementsByTagNameNS(W, "rPr")[0];
      const ue = rPr?.getElementsByTagNameNS(W, "u")[0];
      if (ue) u = (ue.getAttributeNS(W, "val") || ue.getAttribute("w:val") || "single") !== "none";
      let piece = "";
      for (const c of Array.from(r.childNodes) as Element[]) {
        if (c.localName === "t") piece += c.textContent;
        else if (c.localName === "tab") piece += "\t";
        else if (c.localName === "br" || c.localName === "cr") piece += "\n";
      }
      if (!piece) continue;
      if (u && piece.trim() && !inU) {
        text += "«";
        inU = true;
      }
      if (!u && inU) {
        text += "»";
        inU = false;
      }
      text += piece;
    }
    if (inU) text += "»";
    text = text.replace(/«(\s*)/g, "$1«").replace(/(\s*)»/g, "»$1");
    out.push(...text.split("\n"));
  }
  return out;
}

interface RawOpt {
  label: string;
  text: string;
  star: boolean;
}

function parseOptionsLine(line: string): RawOpt[] | null {
  const m = line.match(OPT_START) || line.match(OPT_START_DOT);
  if (!m) return null;
  const first: RawOpt = { label: m[2]!, text: m[3]!, star: !!m[1] };
  const opts: RawOpt[] = [first];
  const sets = LABEL_SETS.filter((s) => s.includes(first.label));
  const padded = " " + first.text;
  const re = new RegExp(OPT_SPLIT.source, "g");
  const found: { idx: number; len: number; star: boolean; label: string }[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(padded)) !== null) found.push({ idx: mm.index, len: mm[0].length, star: !!mm[1], label: mm[2]! });
  let prev = first.label;
  const accepted: typeof found = [];
  for (const f of found) {
    if (sets.some((s) => s.indexOf(f.label) === s.indexOf(prev) + 1)) {
      accepted.push(f);
      prev = f.label;
    }
  }
  if (accepted.length) {
    first.text = padded.slice(1, accepted[0]!.idx);
    accepted.forEach((a, i) => {
      const end = i + 1 < accepted.length ? accepted[i + 1]!.idx : padded.length;
      opts.push({ label: a.label, text: padded.slice(a.idx + a.len, end), star: a.star });
    });
  }
  for (const o of opts) {
    o.text = squash(o.text);
    if (/\*\s*$/.test(o.text)) {
      o.star = true;
      o.text = o.text.replace(/\s*\*+\s*$/, "");
    }
    if (CORRECT_MARK.test(o.text)) {
      o.star = true;
      o.text = squash(o.text.replace(CORRECT_MARK, " "));
    }
    o.text = o.text.replace(/^\|+\s*/, "").replace(/[«»]/g, "");
  }
  return opts;
}

type Classified =
  | { t: "blank" }
  | { t: "section"; text: string }
  | { t: "opts"; opts: RawOpt[] }
  | { t: "num"; explicit: boolean; n: number; text: string; raw: string }
  | { t: "text"; text: string };

function classify(raw: string): Classified {
  const line = squash(raw);
  if (!line || SEPARATOR.test(line)) return { t: "blank" };
  const a = toAscii(line);
  if (SECTION.test(a.replace(/[«»]/g, ""))) return { t: "section", text: line.replace(/[«»]/g, "") };
  const opts = parseOptionsLine(line);
  if (opts) return { t: "opts", opts };
  const m = a.match(NUM_LINE_Q) || a.match(NUM_LINE);
  if (m) return { t: "num", explicit: !!m[1], n: parseInt(m[2]!, 10), text: line.slice(a.length - m[3]!.length).trim(), raw: line };
  return { t: "text", text: line };
}

const cleanTitle = (s: string) => s.replace(/[«»*]/g, "").replace(/^[^\p{L}\p{N}('"]+/u, "").trim();

interface Draft {
  n: number;
  q: string;
  opts: RawOpt[];
}

export function parse(lines: string[]): QuizModel {
  let keyAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const s = squash(lines[i]!);
    if (s && s.length < 80 && KEY_HEAD.test(s) && i > 2) {
      keyAt = i;
      break;
    }
  }
  const body = keyAt >= 0 ? lines.slice(0, keyAt) : lines;
  const keyText = keyAt >= 0 ? toAscii(lines.slice(keyAt + 1).join("\n")) : "";

  const cls = body.map(classify).filter((c) => c.t !== "blank");
  const header: string[] = [];
  const drafts: (Draft | Section)[] = [];
  let cur: Draft | null = null;
  let lastSection: Section | null = null;
  let sinceSection = false;
  let seenAny = false;
  for (let c = 0; c < cls.length; c++) {
    const L = cls[c]!;
    if (L.t === "section") {
      lastSection = { section: L.text, help: "" };
      drafts.push(lastSection);
      cur = null;
      sinceSection = seenAny = true;
    } else if (L.t === "num") {
      let j = c + 1;
      while (j < cls.length && cls[j]!.t === "text") j++;
      if (L.explicit || (j < cls.length && cls[j]!.t === "opts")) {
        cur = { n: L.n, q: L.text, opts: [] };
        drafts.push(cur);
        sinceSection = false;
      } else {
        lastSection = { section: L.raw.replace(/[«»]/g, ""), help: "" };
        drafts.push(lastSection);
        cur = null;
        sinceSection = true;
      }
      seenAny = true;
    } else if (L.t === "opts") {
      if (cur) cur.opts = cur.opts.concat(L.opts);
    } else if (L.t === "text") {
      if (cur && !cur.opts.length) cur.q += " " + L.text;
      else if (lastSection && sinceSection) lastSection.help = squash((lastSection.help + " " + L.text.replace(/^\((.*)\)$/, "$1")).replace(/[«»]/g, ""));
      else if (!seenAny) header.push(L.text);
    }
  }

  const qs = drafts.filter((d): d is Draft => (d as Draft).q !== undefined);
  const uniqueNums = new Set(qs.map((q) => q.n)).size === qs.length;
  const key: Record<number, string> = {};
  if (keyText) {
    const re = new RegExp(KEY_ITEM.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(keyText)) !== null) {
      const n = parseInt(m[1]!, 10);
      if (!(n in key)) key[n] = m[2]!;
      re.lastIndex = m.index + m[0].length;
    }
  }
  const keyCount = Object.keys(key).length;

  const done = new Map<Draft, Question>();
  qs.forEach((d, idx) => {
    const flags: Flag[] = [];
    const words: string[] = [];
    const qText = squash(
      d.q.replace(/«([^»]*)»/g, (_, w: string) => {
        const t = w.trim();
        if (t) words.push(t);
        return '"' + t + '"';
      }),
    ).replace(/""/g, '"');
    const seen: Record<string, number> = {};
    const kept: RawOpt[] = [];
    const removed: RawOpt[] = [];
    const remap: Record<number, number> = {};
    d.opts.forEach((o, oi) => {
      const k = normKey(o.text);
      if (k in seen) {
        removed.push(o);
        remap[oi] = seen[k]!;
        return;
      }
      seen[k] = kept.length;
      remap[oi] = kept.length;
      kept.push(o);
    });
    const labels = d.opts.map((o) => o.label);
    const keyLabel = key[uniqueNums ? d.n : idx + 1];
    let keyIdx = -1;
    if (keyLabel) {
      let li = labels.indexOf(keyLabel);
      if (li < 0) li = labels.map((l) => l.toLowerCase()).indexOf(keyLabel.toLowerCase());
      if (li < 0) for (const s of LABEL_SETS) if (li < 0 && s.includes(keyLabel) && s.indexOf(keyLabel) < labels.length) li = s.indexOf(keyLabel);
      if (li >= 0) keyIdx = remap[li]!;
    }
    let starIdx = -1;
    d.opts.forEach((o, oi) => {
      if (o.star && starIdx < 0) starIdx = remap[oi]!;
    });
    let answer = -1;
    let source: Question["source"] = "none";
    if (keyIdx >= 0) {
      answer = keyIdx;
      source = "key";
      if (starIdx >= 0 && starIdx !== keyIdx) flags.push({ t: "conflict", alt: starIdx });
    } else if (starIdx >= 0) {
      answer = starIdx;
      source = "mark";
      if (keyCount) flags.push({ t: "nokey" });
    } else flags.push({ t: "noanswer" });
    const options = kept.map((o) => ({ label: o.label, text: o.text }));
    if (removed.length) flags.push({ t: "dupe", texts: removed.map((o) => o.label + ") " + o.text) });
    if (options.length < 2) flags.push({ t: "few" });
    if (ODD_SCRIPT.test(qText) || options.some((o) => ODD_SCRIPT.test(o.text))) flags.push({ t: "odd" });
    done.set(d, { n: d.n, q: qText, word: words.join(", "), options, answer, source, flags });
  });

  return {
    title: header.length ? cleanTitle(header[0]!) : "",
    description: header
      .slice(1)
      .map((h) => h.replace(/[«»*]/g, "").trim())
      .filter(Boolean)
      .join("\n"),
    items: drafts.map((d) => done.get(d as Draft) ?? { section: (d as Section).section.replace(/\*/g, ""), help: (d as Section).help }),
    keyFound: keyAt >= 0,
    keyCount,
  };
}

export const parseText = (text: string) => parse(splitLines(text));

/** Problems worth a look before making the form (the reviewed flag clears them). */
export function needsLook(q: Question): boolean {
  return !q.reviewed && q.flags.some((f) => f.t !== "nokey");
}

export function defaultSettings(model: QuizModel, fallbackTitle: string): FormSettings {
  const mr = isMarathi(model.title + model.description);
  return {
    title: model.title || fallbackTitle,
    description: model.description,
    points: 1,
    confirm: mr ? 'तुमची उत्तरे जमा झाली आहेत. निकाल पाहण्यासाठी "View score" वर क्लिक करा.' : 'Your answers have been submitted. Click "View score" to see your result.',
    student: true,
    keepLetters: true,
    headings: true,
    pages: false,
    shuffle: false,
  };
}

/** Same payload the artifact's MCQ.buildPayload() produces, so both send identical forms. */
export function buildPayload(model: QuizModel, st: FormSettings): FormPayload {
  const items: PayloadItem[] = [];
  for (const it of model.items) {
    if (isSection(it)) {
      if (st.headings) items.push({ section: it.section, help: it.help || "" });
      continue;
    }
    const q: PayloadItem = { q: it.q, options: it.options.map((o) => (st.keepLetters ? o.label + ") " + o.text : o.text)), answer: it.answer };
    if (it.word) q.word = it.word;
    items.push(q);
  }
  const mr = isMarathi(st.title + model.items.map((i) => (isQuestion(i) ? i.q : "")).join(""));
  return {
    title: st.title.trim() || "MCQ Test",
    description: st.description,
    points: Math.max(0, Math.floor(Number(st.points)) || 0),
    student: st.student,
    pages: st.pages,
    shuffle: st.shuffle,
    confirm: st.confirm,
    nameLabel: mr ? "विद्यार्थ्याचे नाव (Student Name)" : "Student Name",
    rollLabel: mr ? "हजेरी क्रमांक (Roll No.)" : "Roll No.",
    wordLabel: mr ? "अधोरेखित शब्द (Underlined word): " : "Underlined word: ",
    items,
  };
}
