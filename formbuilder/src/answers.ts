/**
 * Optional answer suggestions: fills in questions that have no answer key.
 *
 * Not configured in this version. The builder hides "Suggest answers" while no provider is set,
 * and POST /api/answers/suggest answers 501. To add one later (for example an LLM), implement
 * AnswerProvider and return it from answerProviderFromEnv(); see README "Answer suggestions".
 */
import type { Config } from "./config.ts";

export interface QuestionForSuggestion {
  /** Position in the request, echoed back in the answer. */
  index: number;
  question: string;
  options: string[];
  /** Underlined word the question is about, if any. */
  word?: string;
}

export interface SuggestedAnswer {
  index: number;
  /** 0-based option index. */
  answer: number;
  /** Short reason, optional. */
  why?: string;
}

export interface AnswerProvider {
  readonly name: string;
  suggest(questions: QuestionForSuggestion[]): Promise<SuggestedAnswer[]>;
}

/** No provider ships yet. Return one here when ANSWER_PROVIDER (or similar) is configured. */
export function answerProviderFromEnv(_cfg: Config, _env: Record<string, string | undefined> = process.env): AnswerProvider | null {
  return null;
}
