"""
API Discovery Engine.

Discovers the underlying REST/JSON API that a career page is backed by —
without any browser automation or HTML scraping.

Discovery pipeline (in order of preference):
  1. Known ATS fingerprint headers  (X-Greenhouse-Token, Lever-*, etc.)
  2. Inline <meta> / <script> JSON blobs that contain apiUrl / boardToken
  3. JS source probing — scan referenced .js files for known API patterns
  4. Common endpoint probing — try well-known paths on the same origin

The engine never renders JavaScript and never spawns a browser.
It only uses requests + lightweight regex on plain HTTP responses.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, NamedTuple, Optional
from urllib.parse import urljoin, urlparse

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------


class DiscoveredAPI(NamedTuple):
    """Describes a successfully discovered API endpoint."""

    ats_type:    str          # e.g. "greenhouse", "lever", "lever_v2", "unknown"
    api_url:     str          # Callable endpoint URL
    token:       str          # Board/company token or slug (empty string if N/A)
    source:      str          # How it was found: "header" | "meta" | "js_scan" | "probe"
    extra:       Dict[str, Any]  # ATS-specific extra params (e.g. department filter)


# ---------------------------------------------------------------------------
# Regex catalogue — what we look for inside HTML / JS payloads
# ---------------------------------------------------------------------------

# Greenhouse board token embedded as a JSON/JS variable
_GH_TOKEN_RE = re.compile(
    r'(?:boardToken|board_token|greenhouse_token|GH_TOKEN)["\s]*[:=]["\s]*([A-Za-z0-9_-]{4,80})',
    re.IGNORECASE,
)

# Lever company slug from canonical URL or JS config
_LEVER_SLUG_RE = re.compile(
    r'jobs\.lever\.co/([A-Za-z0-9_-]+)',
    re.IGNORECASE,
)
_LEVER_API_RE = re.compile(
    r'api\.lever\.co/v\d/postings/([A-Za-z0-9_-]+)',
    re.IGNORECASE,
)

# Workday tenant ID from myworkdayjobs.com subdomain
_WORKDAY_TENANT_RE = re.compile(
    r'https?://([A-Za-z0-9_-]+)\.myworkdayjobs\.com',
    re.IGNORECASE,
)
_WORKDAY_PATH_RE = re.compile(
    r'myworkdayjobs\.com/([A-Za-z0-9_-]+)/([A-Za-z0-9_-]+)',
    re.IGNORECASE,
)

# iCIMS board ID
_ICIMS_BOARD_RE = re.compile(
    r'careers\.icims\.com/jobs/([A-Za-z0-9]+)',
    re.IGNORECASE,
)

# Ashby (used by many YC / growth startups)
_ASHBY_SLUG_RE = re.compile(
    r'jobs\.ashbyhq\.com/([A-Za-z0-9_-]+)',
    re.IGNORECASE,
)

# Rippling / Rippling Jobs
_RIPPLING_RE = re.compile(
    r'app\.rippling\.com/jobs/([A-Za-z0-9_-]+)',
    re.IGNORECASE,
)

# BambooHR
_BAMBOO_SLUG_RE = re.compile(
    r'([A-Za-z0-9_-]+)\.bamboohr\.com',
    re.IGNORECASE,
)

# SmartRecruiters
_SMART_RE = re.compile(
    r'careers\.smartrecruiters\.com/([A-Za-z0-9_-]+)',
    re.IGNORECASE,
)

# Jobvite
_JOBVITE_RE = re.compile(
    r'jobs\.jobvite\.com/([A-Za-z0-9_-]+)',
    re.IGNORECASE,
)

# JazzHR
_JAZZHR_RE = re.compile(
    r'([A-Za-z0-9_-]+)\.applytojob\.com',
    re.IGNORECASE,
)

# Breezy HR
_BREEZY_RE = re.compile(
    r'([A-Za-z0-9_-]+)\.breezy\.hr',
    re.IGNORECASE,
)

# Recruitee
_RECRUITEE_RE = re.compile(
    r'([A-Za-z0-9_-]+)\.recruitee\.com',
    re.IGNORECASE,
)

# Workable
_WORKABLE_SLUG_RE = re.compile(
    r'(?:apply\.workable\.com|careers\.workable\.com)/([A-Za-z0-9_-]+)',
    re.IGNORECASE,
)
_WORKABLE_JS_RE = re.compile(
    r'"company":\s*"([A-Za-z0-9_-]+)"',
    re.IGNORECASE,
)

# Pinpoint
_PINPOINT_RE = re.compile(
    r'([A-Za-z0-9_-]+)\.pinpointhq\.com',
    re.IGNORECASE,
)

# Comeet
_COMEET_RE = re.compile(
    r'www\.comeet\.com/jobs/([A-Za-z0-9_-]+)',
    re.IGNORECASE,
)

# Teamtailor
_TEAMTAILOR_RE = re.compile(
    r'"token":\s*"([A-Za-z0-9_-]+)"',
    re.IGNORECASE,
)

# Generic apiUrl / endpointUrl mentioned anywhere in scripts
_GENERIC_API_RE = re.compile(
    r'"(?:apiUrl|api_url|jobsApiUrl|endpointUrl)"\s*:\s*"(https?://[^"]{10,200})"',
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Probe catalogue — paths to try per origin if pattern matching fails
# ---------------------------------------------------------------------------

_PROBES: List[Dict[str, Any]] = [
    # Greenhouse
    {"path": "/embed/jobs.json",              "ats_type": "greenhouse",     "check": lambda d: isinstance(d, dict) and "jobs" in d},
    {"path": "/careers/jobs.json",            "ats_type": "greenhouse",     "check": lambda d: isinstance(d, dict) and "jobs" in d},
    # Lever
    {"path": "/postings?format=json",         "ats_type": "lever",          "check": lambda d: isinstance(d, list)},
    {"path": "/jobs?format=json",             "ats_type": "lever",          "check": lambda d: isinstance(d, list)},
    # Ashby
    {"path": "/api/getJobPostings",           "ats_type": "ashby",          "check": lambda d: isinstance(d, dict) and "jobPostings" in d},
    # SmartRecruiters
    {"path": "/v1/companies/-/postings?limit=100", "ats_type": "smartrecruiters", "check": lambda d: isinstance(d, dict) and "content" in d},
    # Workable  
    {"path": "/spi/v3/jobs",                  "ats_type": "workable",       "check": lambda d: isinstance(d, dict) and "jobs" in d},
    # Generic paginated jobs API
    {"path": "/api/jobs",                     "ats_type": "generic_api",    "check": lambda d: isinstance(d, (list, dict))},
    {"path": "/api/v1/jobs",                  "ats_type": "generic_api",    "check": lambda d: isinstance(d, (list, dict))},
    {"path": "/api/v2/jobs",                  "ats_type": "generic_api",    "check": lambda d: isinstance(d, (list, dict))},
    {"path": "/careers/api/jobs",             "ats_type": "generic_api",    "check": lambda d: isinstance(d, (list, dict))},
    {"path": "/jobs.json",                    "ats_type": "generic_api",    "check": lambda d: isinstance(d, (list, dict))},
]


# ---------------------------------------------------------------------------
# Main discovery engine
# ---------------------------------------------------------------------------


class APIDiscoveryEngine:
    """
    Discovers the backing API for a career page URL.

    :param session: Shared requests.Session (inherits headers/retries from
                    BaseScraper). Pass None to create a lightweight fallback.
    :param timeout: Per-request timeout in seconds.
    """

    def __init__(
        self,
        session: Optional[requests.Session] = None,
        timeout: int = 15,
    ) -> None:
        if session is None:
            session = requests.Session()
            session.headers.update({
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json, text/html, */*",
                "Accept-Language": "en-US,en;q=0.9",
            })
        self._session = session
        self._timeout = timeout

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def discover(self, url: str) -> Optional[DiscoveredAPI]:
        """
        Run the full discovery pipeline for *url*.

        Returns the first DiscoveredAPI found, or None if every method
        exhausts without identifying a usable JSON endpoint.
        """
        logger.info("API discovery starting for: %s", url)

        # ---- Step 1: URL / header-based fingerprinting ----
        found = self._fingerprint_url(url)
        if found:
            logger.info("[discovery:url-fingerprint] %s → %s (%s)", url, found.ats_type, found.api_url)
            return found

        # ---- Step 2: Fetch the page for content analysis ----
        html = self._fetch_text(url)
        if not html:
            logger.warning("Could not fetch %s for API discovery", url)
            return None

        # Check response headers of the page for ATS hints
        found = self._fingerprint_headers(url)
        if found:
            logger.info("[discovery:header] %s → %s", url, found.ats_type)
            return found

        # ---- Step 3: Scan inline HTML/script for token patterns ----
        found = self._scan_content(url, html)
        if found:
            logger.info("[discovery:content-scan] %s → %s (%s)", url, found.ats_type, found.api_url)
            return found

        # ---- Step 4: Scan referenced JS files ----
        found = self._scan_js_files(url, html)
        if found:
            logger.info("[discovery:js-scan] %s → %s (%s)", url, found.ats_type, found.api_url)
            return found

        # ---- Step 5: Probe well-known paths on same origin ----
        found = self._probe_common_paths(url)
        if found:
            logger.info("[discovery:probe] %s → %s (%s)", url, found.ats_type, found.api_url)
            return found

        logger.warning("API discovery exhausted for %s — no endpoint found", url)
        return None

    # ------------------------------------------------------------------
    # Step 1 — URL fingerprinting
    # ------------------------------------------------------------------

    def _fingerprint_url(self, url: str) -> Optional[DiscoveredAPI]:
        """Identify ATS purely from URL, construct canonical API URL."""

        # Greenhouse —  boards.greenhouse.io/<token>
        m = re.search(r'boards\.greenhouse\.io/([A-Za-z0-9_-]+)', url, re.IGNORECASE)
        if m:
            token = m.group(1)
            api = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
            return DiscoveredAPI("greenhouse", api, token, "url-fingerprint", {})

        # Greenhouse — /embed/job_board?for=<token>
        m = re.search(r'for=([A-Za-z0-9_-]+)', url, re.IGNORECASE)
        if m and "greenhouse" in url.lower():
            token = m.group(1)
            api = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
            return DiscoveredAPI("greenhouse", api, token, "url-fingerprint", {})

        # Lever — jobs.lever.co/<slug>
        m = _LEVER_SLUG_RE.search(url)
        if m:
            slug = m.group(1)
            api  = f"https://api.lever.co/v0/postings/{slug}?mode=json"
            return DiscoveredAPI("lever", api, slug, "url-fingerprint", {})

        # Workday — <tenant>.myworkdayjobs.com/<path>/<site>
        m = _WORKDAY_PATH_RE.search(url)
        if m:
            tenant  = _WORKDAY_TENANT_RE.search(url)
            tenant_id = tenant.group(1) if tenant else ""
            site_id  = m.group(2)
            api = (
                f"https://{tenant_id}.myworkdayjobs.com/wday/cxs/{tenant_id}"
                f"/{site_id}/jobs"
            )
            return DiscoveredAPI("workday", api, tenant_id, "url-fingerprint", {})

        # Ashby — jobs.ashbyhq.com/<slug>
        m = _ASHBY_SLUG_RE.search(url)
        if m:
            slug = m.group(1)
            api  = f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true"
            return DiscoveredAPI("ashby", api, slug, "url-fingerprint", {})

        # BambooHR — <company>.bamboohr.com
        m = _BAMBOO_SLUG_RE.search(url)
        if m:
            slug = m.group(1)
            api  = f"https://{slug}.bamboohr.com/careers/list"
            return DiscoveredAPI("bamboohr", api, slug, "url-fingerprint", {})

        # SmartRecruiters — careers.smartrecruiters.com/<slug>
        m = _SMART_RE.search(url)
        if m:
            slug = m.group(1)
            api  = f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100"
            return DiscoveredAPI("smartrecruiters", api, slug, "url-fingerprint", {})

        # Workable — apply.workable.com/<slug>
        m = _WORKABLE_SLUG_RE.search(url)
        if m:
            slug = m.group(1)
            api  = f"https://apply.workable.com/api/v3/accounts/{slug}/jobs"
            return DiscoveredAPI("workable", api, slug, "url-fingerprint", {})

        # Recruitee — <slug>.recruitee.com
        m = _RECRUITEE_RE.search(url)
        if m:
            slug = m.group(1)
            api  = f"https://{slug}.recruitee.com/api/offers/"
            return DiscoveredAPI("recruitee", api, slug, "url-fingerprint", {})

        # Breezy HR — <slug>.breezy.hr
        m = _BREEZY_RE.search(url)
        if m:
            slug = m.group(1)
            api  = f"https://{slug}.breezy.hr/json"
            return DiscoveredAPI("breezy", api, slug, "url-fingerprint", {})

        # Jobvite — jobs.jobvite.com/<slug>
        m = _JOBVITE_RE.search(url)
        if m:
            slug = m.group(1)
            api  = f"https://api.jobvite.com/api/v2/job?companyId={slug}&api={slug}"
            return DiscoveredAPI("jobvite", api, slug, "url-fingerprint", {})

        # JazzHR — <slug>.applytojob.com
        m = _JAZZHR_RE.search(url)
        if m:
            slug = m.group(1)
            api  = f"https://{slug}.applytojob.com/apply/jobs/json"
            return DiscoveredAPI("jazzhr", api, slug, "url-fingerprint", {})

        # Pinpoint — <slug>.pinpointhq.com
        m = _PINPOINT_RE.search(url)
        if m:
            slug = m.group(1)
            api  = f"https://{slug}.pinpointhq.com/api/v1/jobs.json"
            return DiscoveredAPI("pinpoint", api, slug, "url-fingerprint", {})

        # Comeet — www.comeet.com/jobs/<slug>
        m = _COMEET_RE.search(url)
        if m:
            slug = m.group(1)
            api  = f"https://www.comeet.com/jobs/{slug}/api/positions"
            return DiscoveredAPI("comeet", api, slug, "url-fingerprint", {})

        # Rippling — app.rippling.com/jobs/<slug>
        m = _RIPPLING_RE.search(url)
        if m:
            slug = m.group(1)
            api  = f"https://app.rippling.com/api/v1/job_postings/public/?company_name={slug}"
            return DiscoveredAPI("rippling", api, slug, "url-fingerprint", {})

        return None

    # ------------------------------------------------------------------
    # Step 2 — Response-header fingerprinting
    # ------------------------------------------------------------------

    def _fingerprint_headers(self, url: str) -> Optional[DiscoveredAPI]:
        """Look for ATS-specific response headers that disclose the platform."""
        try:
            resp = self._session.head(url, timeout=self._timeout, allow_redirects=True)
            headers_lower = {k.lower(): v for k, v in resp.headers.items()}

            # Greenhouse sets X-Greenhouse-Board-Token on job board pages
            if "x-greenhouse-board-token" in headers_lower:
                token = headers_lower["x-greenhouse-board-token"]
                api = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
                return DiscoveredAPI("greenhouse", api, token, "header", {})

            # Lever sets x-powered-by: Express + location redirect to jobs.lever.co
            final_url = resp.url
            m = _LEVER_SLUG_RE.search(final_url)
            if m:
                slug = m.group(1)
                api  = f"https://api.lever.co/v0/postings/{slug}?mode=json"
                return DiscoveredAPI("lever", api, slug, "header", {})

        except Exception as exc:
            logger.debug("Header fingerprint failed for %s: %s", url, exc)

        return None

    # ------------------------------------------------------------------
    # Step 3 — Inline content scan
    # ------------------------------------------------------------------

    def _scan_content(self, url: str, html: str) -> Optional[DiscoveredAPI]:
        """Extract ATS tokens embedded in inline <script> or <meta> tags."""

        # Greenhouse board token in inline JS
        m = _GH_TOKEN_RE.search(html)
        if m:
            token = m.group(1)
            api = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
            return DiscoveredAPI("greenhouse", api, token, "content-scan", {})

        # Lever slug referenced in page body
        m = _LEVER_SLUG_RE.search(html)
        if m:
            slug = m.group(1)
            api  = f"https://api.lever.co/v0/postings/{slug}?mode=json"
            return DiscoveredAPI("lever", api, slug, "content-scan", {})

        # Ashby slug
        m = _ASHBY_SLUG_RE.search(html)
        if m:
            slug = m.group(1)
            api  = f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true"
            return DiscoveredAPI("ashby", api, slug, "content-scan", {})

        # Workday tenant
        m = _WORKDAY_TENANT_RE.search(html)
        if m:
            tenant = m.group(1)
            path_m = _WORKDAY_PATH_RE.search(html)
            if path_m:
                site_id = path_m.group(2)
                api = (
                    f"https://{tenant}.myworkdayjobs.com/wday/cxs/{tenant}"
                    f"/{site_id}/jobs"
                )
                return DiscoveredAPI("workday", api, tenant, "content-scan", {})

        # Workable slug in JS config
        m = _WORKABLE_JS_RE.search(html)
        if m:
            slug = m.group(1)
            api  = f"https://apply.workable.com/api/v3/accounts/{slug}/jobs"
            return DiscoveredAPI("workable", api, slug, "content-scan", {})

        # SmartRecruiters
        m = _SMART_RE.search(html)
        if m:
            slug = m.group(1)
            api  = f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100"
            return DiscoveredAPI("smartrecruiters", api, slug, "content-scan", {})

        # Recruitee
        m = _RECRUITEE_RE.search(html)
        if m:
            slug = m.group(1)
            api  = f"https://{slug}.recruitee.com/api/offers/"
            return DiscoveredAPI("recruitee", api, slug, "content-scan", {})

        # Generic apiUrl embedded in JSON blob
        m = _GENERIC_API_RE.search(html)
        if m:
            api = m.group(1)
            return DiscoveredAPI("generic_api", api, "", "content-scan", {})

        return None

    # ------------------------------------------------------------------
    # Step 4 — External JS file scan
    # ------------------------------------------------------------------

    def _scan_js_files(self, url: str, html: str) -> Optional[DiscoveredAPI]:
        """
        Extract <script src="..."> URLs from the page, fetch each and
        run the same regex catalogue against the JS source.
        Limits to the first 5 app/vendor JS files to stay fast.
        """
        script_src_re = re.compile(r'<script[^>]+src=["\']([^"\']+\.js[^"\']*)["\']', re.IGNORECASE)
        srcs = script_src_re.findall(html)
        # Prioritise files likely to contain config (app.js, main.js, config.js etc.)
        priority = [s for s in srcs if any(kw in s for kw in ("app", "main", "config", "careers", "jobs", "embed"))]
        candidates = (priority + [s for s in srcs if s not in priority])[:6]

        for src in candidates:
            js_url = src if src.startswith("http") else urljoin(url, src)
            js_text = self._fetch_text(js_url)
            if not js_text:
                continue
            found = self._scan_content(url, js_text)  # reuse same regexes
            if found:
                return DiscoveredAPI(found.ats_type, found.api_url, found.token, "js-scan", found.extra)

        return None

    # ------------------------------------------------------------------
    # Step 5 — Common path probing
    # ------------------------------------------------------------------

    def _probe_common_paths(self, url: str) -> Optional[DiscoveredAPI]:
        """
        Attempt GET requests to well-known API paths on the same origin.
        Accepts the response only if it parses as valid JSON and passes
        the content-check lambda defined in _PROBES.
        """
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"

        for probe in _PROBES:
            probe_url = origin + probe["path"]
            try:
                resp = self._session.get(probe_url, timeout=self._timeout)
                if resp.status_code not in (200, 206):
                    continue
                ct = resp.headers.get("Content-Type", "")
                if "json" not in ct and not resp.text.lstrip().startswith(("[", "{")):
                    continue
                data = resp.json()
                if probe["check"](data):
                    logger.debug("Probe hit: %s → %s", probe["ats_type"], probe_url)
                    return DiscoveredAPI(probe["ats_type"], probe_url, "", "probe", {})
            except Exception:
                continue

        return None

    # ------------------------------------------------------------------
    # HTTP helper
    # ------------------------------------------------------------------

    def _fetch_text(self, url: str) -> Optional[str]:
        try:
            resp = self._session.get(url, timeout=self._timeout)
            if resp.ok:
                return resp.text
        except Exception as exc:
            logger.debug("fetch_text failed for %s: %s", url, exc)
        return None
