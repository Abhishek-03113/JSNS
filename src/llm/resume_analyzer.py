"""
LLM Resume Analyzer.

Supports Anthropic Claude and OpenAI GPT via a simple provider abstraction.
The provider is selected by LLMSettings.provider ("anthropic" | "openai").

Resume summary is computed once per session and cached to avoid redundant API calls.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from src.config.settings import LLMSettings
from src.database.models import Job, ResumeAnalysis
from src.llm.prompts import (
    RESUME_ANALYSIS_PROMPT,
    RESUME_EXPERT_SYSTEM_PROMPT,
    RESUME_SUMMARY_PROMPT,
    SKILL_EXTRACTION_PROMPT,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Provider abstraction
# ---------------------------------------------------------------------------


class LLMProvider:
    """Thin wrapper that hides Anthropic vs OpenAI differences."""

    def __init__(self, settings: LLMSettings) -> None:
        self._settings = settings
        self._client = self._build_client()

    def _build_client(self) -> Any:
        provider = self._settings.provider.lower()
        if provider == "anthropic":
            try:
                import anthropic  # type: ignore
                return anthropic.Anthropic(api_key=self._settings.api_key)
            except ImportError as exc:
                raise ImportError("Install anthropic>=0.40: pip install anthropic") from exc
        elif provider == "openai":
            try:
                import openai  # type: ignore
                return openai.OpenAI(api_key=self._settings.api_key)
            except ImportError as exc:
                raise ImportError("Install openai>=1.50: pip install openai") from exc
        else:
            raise ValueError(f"Unsupported LLM provider: {self._settings.provider!r}")

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        """
        Send a chat completion and return the assistant's text response.

        Args:
            system_prompt: System / context instructions.
            user_prompt: User message.

        Returns:
            Raw string response from the LLM.
        """
        provider = self._settings.provider.lower()
        if provider == "anthropic":
            response = self._client.messages.create(
                model=self._settings.model,
                max_tokens=self._settings.max_tokens,
                temperature=self._settings.temperature,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            return response.content[0].text
        elif provider == "openai":
            response = self._client.chat.completions.create(
                model=self._settings.model,
                max_tokens=self._settings.max_tokens,
                temperature=self._settings.temperature,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
            return response.choices[0].message.content
        raise RuntimeError("Unreachable")


# ---------------------------------------------------------------------------
# Resume Analyzer
# ---------------------------------------------------------------------------


class ResumeAnalyzer:
    """
    Analyses resume fitness for job listings using an LLM.

    Features:
    - Resume summary is cached after the first call (no re-processing).
    - Batch-analyse many jobs with a single resume.
    - Graceful error handling — returns a zero-score analysis on failure.
    """

    def __init__(self, settings: LLMSettings) -> None:
        self._settings = settings
        self._provider = LLMProvider(settings)
        self._resume_summary_cache: Optional[Dict[str, Any]] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze_job_match(self, resume_text: str, job: Job) -> ResumeAnalysis:
        """
        Analyse how well *resume_text* matches *job*.

        Args:
            resume_text: Plain text of the candidate's resume.
            job: Job instance to analyse against.

        Returns:
            ResumeAnalysis with score, matches, missing skills, and advice.
        """
        prompt = RESUME_ANALYSIS_PROMPT.format(
            job_title=job.title,
            job_description=job.description or f"{job.title} at {job.company}",
            resume_text=resume_text[:4000],  # Guard against token overflow
        )
        try:
            raw = self._provider.complete(RESUME_EXPERT_SYSTEM_PROMPT, prompt)
            parsed = self._parse_json(raw)
            return ResumeAnalysis(
                job_id=job.id,
                resume_score=float(parsed.get("resume_score", 0)),
                strong_matches=parsed.get("strong_matches", []),
                missing_skills=parsed.get("missing_skills", []),
                keyword_matches=parsed.get("keyword_matches", {}),
                recommendations=parsed.get("recommendations", ""),
            )
        except Exception as exc:
            logger.error("LLM analysis failed for job %s: %s", job.id, exc)
            return ResumeAnalysis(job_id=job.id, resume_score=0.0)

    def batch_analyze(self, resume_text: str, jobs: List[Job]) -> List[ResumeAnalysis]:
        """
        Analyse a resume against multiple jobs.

        Args:
            resume_text: Plain text of the candidate's resume.
            jobs: List of Job instances.

        Returns:
            List of ResumeAnalysis results (same order as *jobs*).
        """
        results = []
        for job in jobs:
            logger.info("Analysing job %s – %s", job.id, job.title)
            results.append(self.analyze_job_match(resume_text, job))
        return results

    def get_resume_summary(self, resume_text: str) -> Dict[str, Any]:
        """
        Summarise resume into structured profile (cached).

        Args:
            resume_text: Plain text resume.

        Returns:
            Dict with core_skills, years_experience, education, etc.
        """
        if self._resume_summary_cache:
            return self._resume_summary_cache

        prompt = RESUME_SUMMARY_PROMPT.format(resume_text=resume_text[:4000])
        try:
            raw = self._provider.complete(RESUME_EXPERT_SYSTEM_PROMPT, prompt)
            self._resume_summary_cache = self._parse_json(raw)
        except Exception as exc:
            logger.error("Resume summary failed: %s", exc)
            self._resume_summary_cache = {}

        return self._resume_summary_cache

    def extract_skills_from_jd(self, description: str) -> Dict[str, List[str]]:
        """
        Extract required / preferred / nice-to-have skills from a JD.

        Args:
            description: Job description text.

        Returns:
            Dict with 'required', 'preferred', 'nice_to_have' skill lists.
        """
        prompt = SKILL_EXTRACTION_PROMPT.format(job_description=description[:3000])
        try:
            raw = self._provider.complete(RESUME_EXPERT_SYSTEM_PROMPT, prompt)
            return self._parse_json(raw)
        except Exception as exc:
            logger.error("Skill extraction failed: %s", exc)
            return {"required": [], "preferred": [], "nice_to_have": []}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_json(text: str) -> Dict[str, Any]:
        """
        Extract and parse a JSON object from *text*.

        Strips markdown fences and leading/trailing non-JSON content.
        """
        # Remove ```json … ``` fences if present
        text = re.sub(r"```(?:json)?\s*", "", text).strip()
        # Find first { … } block
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise ValueError(f"No JSON object found in LLM response: {text[:200]!r}")
