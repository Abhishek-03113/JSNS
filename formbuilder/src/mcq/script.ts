/**
 * The form payload is exactly what the MCQ Form Builder artifact's MCQ.buildPayload() returns.
 * Parsing papers stays in the artifact; this module only validates the payload and renders the
 * standalone script (same template as the artifact's MCQ.buildScript()) for storage.
 */
export type PayloadItem = { section: string; help: string } | { q: string; options: string[]; answer: number; word?: string };

export interface FormPayload {
  title: string;
  description: string;
  points: number;
  student: boolean;
  pages: boolean;
  shuffle: boolean;
  confirm: string;
  nameLabel: string;
  rollLabel: string;
  wordLabel: string;
  items: PayloadItem[];
}

export function questionCount(p: FormPayload): number {
  return p.items.filter((i) => "q" in i).length;
}

export function unansweredCount(p: FormPayload): number {
  return p.items.filter((i) => "q" in i && i.answer < 0).length;
}

/** The standalone script a teacher can paste into script.google.com. Identical to the artifact's output. */
export function buildScript(p: FormPayload): string {
  const j = (v: unknown) => JSON.stringify(v);
  return [
    "/**",
    " * " + p.title.replace(/\*\//g, "* /") + " - Google Form (Quiz) generator",
    " * " + questionCount(p) + " questions. Made with MCQ Form Builder.",
    " *",
    " * How to use:",
    " *   1. Go to https://script.google.com and click New project",
    " *   2. Delete the default code, paste this whole file, Save",
    ' *   3. Select "createMcqQuiz" in the toolbar and click Run',
    " *   4. Approve the permissions prompt (first run only)",
    " *   5. Open the Execution log to get the edit link and the student link",
    " * Run it once: every run creates a new copy of the form.",
    " */",
    "",
    "var FORM_TITLE = " + j(p.title) + ";",
    "var FORM_DESCRIPTION = " + j(p.description) + ";",
    "var POINTS_PER_QUESTION = " + p.points + ";",
    "var ASK_STUDENT_DETAILS = " + p.student + ";   // Name and Roll No. fields at the top",
    "var SECTIONS_ON_SEPARATE_PAGES = " + p.pages + ";",
    "var SHUFFLE_QUESTIONS = " + p.shuffle + ";",
    "var CONFIRMATION_MESSAGE = " + j(p.confirm) + ";",
    "var NAME_LABEL = " + j(p.nameLabel) + ";",
    "var ROLL_LABEL = " + j(p.rollLabel) + ";",
    "var WORD_LABEL = " + j(p.wordLabel) + ";",
    "",
    "// Items are a section { section, help } or a question { q, options, answer, word? }.",
    '// "answer" is the index of the correct option, starting from 0 (-1 = not set).',
    "var ITEMS = " + JSON.stringify(p.items, null, 2) + ";",
    "",
    "function createMcqQuiz() {",
    "  var form = FormApp.create(FORM_TITLE);",
    "  form.setTitle(FORM_TITLE)",
    "      .setDescription(FORM_DESCRIPTION)",
    "      .setIsQuiz(true)",
    "      .setShuffleQuestions(SHUFFLE_QUESTIONS)",
    "      .setProgressBar(true)",
    "      .setConfirmationMessage(CONFIRMATION_MESSAGE);",
    "",
    "  if (ASK_STUDENT_DETAILS) {",
    "    form.addTextItem().setTitle(NAME_LABEL).setRequired(true);",
    "    form.addTextItem().setTitle(ROLL_LABEL).setRequired(true);",
    "  }",
    "",
    "  var qNo = 0;",
    "  ITEMS.forEach(function (item) {",
    "    if (item.section !== undefined) {",
    "      var header = SECTIONS_ON_SEPARATE_PAGES && qNo > 0",
    "        ? form.addPageBreakItem()",
    "        : form.addSectionHeaderItem();",
    "      header.setTitle(item.section).setHelpText(item.help || '');",
    "      return;",
    "    }",
    "    qNo++;",
    "    var mc = form.addMultipleChoiceItem();",
    "    var choices = item.options.map(function (opt, i) {",
    "      return mc.createChoice(opt, i === item.answer);",
    "    });",
    "    mc.setTitle(qNo + '. ' + item.q)",
    "      .setChoices(choices)",
    "      .setPoints(POINTS_PER_QUESTION)",
    "      .setRequired(true);",
    "    if (item.word) mc.setHelpText(WORD_LABEL + item.word);",
    "  });",
    "",
    "  Logger.log('Form created with ' + qNo + ' questions.');",
    "  Logger.log('Edit link:    ' + form.getEditUrl());",
    "  Logger.log('Student link: ' + form.getPublishedUrl());",
    "}",
    "",
  ].join("\n");
}

const MAX_ITEMS = 500;
const MAX_TEXT = 5000;

/** Validates an untrusted payload (e.g. posted by the artifact). Returns a clean copy or a list of problems. */
export function validatePayload(input: unknown): { ok: true; payload: FormPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const o = (input ?? {}) as Record<string, unknown>;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["payload must be an object"] };
  const str = (k: string, required: boolean, fallback = ""): string => {
    const v = o[k];
    if (v === undefined || v === null) {
      if (required) errors.push(`${k} is required`);
      return fallback;
    }
    if (typeof v !== "string") {
      errors.push(`${k} must be a string`);
      return fallback;
    }
    if (v.length > MAX_TEXT) errors.push(`${k} is longer than ${MAX_TEXT} characters`);
    return v;
  };
  const bool = (k: string, fallback: boolean): boolean => {
    const v = o[k];
    if (v === undefined) return fallback;
    if (typeof v !== "boolean") errors.push(`${k} must be true or false`);
    return !!v;
  };
  const title = str("title", true).trim();
  if (!title && !errors.some((e) => e.startsWith("title"))) errors.push("title must not be empty");
  const pointsRaw = o.points === undefined ? 1 : Number(o.points);
  if (!Number.isFinite(pointsRaw) || pointsRaw < 0 || pointsRaw > 100) errors.push("points must be a number from 0 to 100");

  const items: PayloadItem[] = [];
  if (!Array.isArray(o.items)) errors.push("items must be an array");
  else {
    if (o.items.length > MAX_ITEMS) errors.push(`items has more than ${MAX_ITEMS} entries`);
    o.items.slice(0, MAX_ITEMS).forEach((raw, i) => {
      const it = (raw ?? {}) as Record<string, unknown>;
      if (typeof it.section === "string") {
        items.push({ section: it.section.slice(0, MAX_TEXT), help: typeof it.help === "string" ? it.help.slice(0, MAX_TEXT) : "" });
        return;
      }
      if (typeof it.q !== "string" || !it.q.trim()) {
        errors.push(`items[${i}] needs a question "q" or a "section"`);
        return;
      }
      const options = Array.isArray(it.options) ? it.options : null;
      if (!options || options.length < 2 || options.some((x) => typeof x !== "string" || !x.trim())) {
        errors.push(`items[${i}].options must be at least two non-empty strings`);
        return;
      }
      if (new Set(options).size !== options.length) {
        errors.push(`items[${i}].options must not repeat (Google Forms rejects duplicate choices)`);
        return;
      }
      const answer = it.answer === undefined ? -1 : Number(it.answer);
      if (!Number.isInteger(answer) || answer < -1 || answer >= options.length) {
        errors.push(`items[${i}].answer must be -1 or an index into options`);
        return;
      }
      const q: PayloadItem = { q: it.q.slice(0, MAX_TEXT), options: options as string[], answer };
      if (typeof it.word === "string" && it.word) q.word = it.word.slice(0, MAX_TEXT);
      items.push(q);
    });
    if (!items.some((i) => "q" in i) && !errors.length) errors.push("items must contain at least one question");
  }

  const payload: FormPayload = {
    title,
    description: str("description", false),
    points: Math.floor(pointsRaw) || 0,
    student: bool("student", true),
    pages: bool("pages", false),
    shuffle: bool("shuffle", false),
    confirm: str("confirm", false),
    nameLabel: str("nameLabel", false, "Student Name") || "Student Name",
    rollLabel: str("rollLabel", false, "Roll No.") || "Roll No.",
    wordLabel: str("wordLabel", false, "Underlined word: ") || "Underlined word: ",
    items,
  };
  return errors.length ? { ok: false, errors } : { ok: true, payload };
}
