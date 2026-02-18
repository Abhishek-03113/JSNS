"""
LLM Prompt Templates.

All prompts are plain-string constants / template functions.
No LLM calls happen here — this module is pure text.
Reuses the resume-expert system prompt from Agent/prompts.py.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Resume writing system prompt (ported from Agent/prompts.py)
# ---------------------------------------------------------------------------

RESUME_EXPERT_SYSTEM_PROMPT = """
<system_prompt>
YOU ARE THE WORLD'S MOST ADVANCED RESUME WRITING EXPERT AND EXECUTIVE BRANDING STRATEGIST.
YOU POSSESS UNPARALLELED EXPERTISE IN CRAFTING, RESTRUCTURING, AND OPTIMIZING RESUMES THAT
SECURE INTERVIEWS AT FORTUNE 500 COMPANIES, TOP CONSULTANCIES, AND ELITE STARTUPS.

YOUR EXPERTISE COMBINES THE SCIENCE OF EMPLOYER PSYCHOLOGY, THE ART OF NARRATIVE POSITIONING,
AND DEEP INSIGHT INTO INDUSTRY-SPECIFIC RECRUITMENT STRATEGIES.

CORE OBJECTIVES:
1. ELEVATE EVERY RESUME TO EXECUTIVE-GRADE QUALITY — STRATEGIC, EVIDENCE-BASED, ATS-OPTIMIZED.
2. EXTRACT AND SHOWCASE VALUE — IDENTIFY EACH CANDIDATE'S UNIQUE STRENGTHS AND COMPETITIVE EDGE.
3. ALIGN THE PROFILE WITH TARGET ROLES.
4. MAXIMIZE IMPACT THROUGH LANGUAGE — STRONG ACTION VERBS, MEASURABLE OUTCOMES.
5. ENSURE ATS-OPTIMIZATION — STRUCTURE CONTENT FOR AUTOMATED SCREENING SYSTEMS.

OUTPUT FORMAT:
- DELIVER ANALYSIS AS VALID JSON ONLY (no markdown fences, no extra text).
- KEYS MUST EXACTLY MATCH THE SCHEMA PROVIDED IN THE USER PROMPT.
</system_prompt>
"""


# ---------------------------------------------------------------------------
# Resume analysis prompt
# ---------------------------------------------------------------------------

RESUME_ANALYSIS_PROMPT = """\
Analyse the candidate's resume against the job description provided below.
Return ONLY valid JSON matching this exact schema:

{{
  "resume_score": <integer 0-100>,
  "strong_matches": ["<skill or experience match>", ...],
  "missing_skills": ["<required skill not present>", ...],
  "keyword_matches": {{"<keyword>": <count>, ...}},
  "recommendations": "<one paragraph of actionable advice>"
}}

--- JOB TITLE ---
{job_title}

--- JOB DESCRIPTION ---
{job_description}

--- RESUME ---
{resume_text}

Respond with JSON only.
"""


# ---------------------------------------------------------------------------
# Skill extraction prompt
# ---------------------------------------------------------------------------

SKILL_EXTRACTION_PROMPT = """\
Extract skills from the job description below.
Return ONLY valid JSON:

{{
  "required": ["<skill>", ...],
  "preferred": ["<skill>", ...],
  "nice_to_have": ["<skill>", ...]
}}

--- JOB DESCRIPTION ---
{job_description}

Respond with JSON only.
"""


# ---------------------------------------------------------------------------
# Resume summary prompt (used for caching — run once per session)
# ---------------------------------------------------------------------------

RESUME_SUMMARY_PROMPT = """\
Summarise the candidate resume into a structured JSON profile.
Return ONLY valid JSON:

{{
  "core_skills": ["<skill>", ...],
  "years_experience": <number or null>,
  "education": ["<degree> from <institution>", ...],
  "notable_achievements": ["<achievement>", ...],
  "industries": ["<industry>", ...],
  "seniority_level": "<entry|mid|senior|lead|executive>"
}}

--- RESUME ---
{resume_text}

Respond with JSON only.
"""
