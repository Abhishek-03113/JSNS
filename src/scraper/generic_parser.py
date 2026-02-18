"""
API Discovery Parser — fallback for URLs not matched by any named ATS strategy.

When the orchestrator finds no registered ATS strategy, it hands the URL to
this parser, which runs the five-stage APIDiscoveryEngine pipeline:
  1. URL fingerprinting
  2. Response-header inspection
  3. Inline content / embedded JSON scanning
  4. External JS file scanning
  5. Common-path probing

Once a DiscoveredAPI is found, the parser calls that endpoint and normalises
the raw JSON into the standard job dict shape.

If discovery also fails, the parser logs a warning and returns an empty list.
There is NO HTML scraping, NO CSS, NO browser automation anywhere in this file.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

from src.scraper.api_discovery import APIDiscoveryEngine, DiscoveredAPI
from src.scraper.base_scraper import BaseScraper, ScraperConfig
from src.utils.helpers import clean_whitespace, truncate_text

logger = logging.getLogger(__name__)


class APIDiscoveryParser(BaseScraper):
    """
    API-first fallback parser.

    Implements the BaseScraper abstract interface so it slots directly
    into the orchestrator wherever GenericCareerParser was used before.
    """

    def __init__(
        self,
        url: str,
        config: Optional[ScraperConfig] = None,
    ) -> None:
        super().__init__(config)
        self.url = url.rstrip("/")
        self._engine = APIDiscoveryEngine(
            session=self.session,
            timeout=self.config.timeout,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def scrape_jobs(self, **kwargs) -> List[Dict[str, Any]]:
        """
        Discover the backing API, call it, and return normalised job dicts.
        Returns an empty list if discovery fails or the API returns no jobs.
        """
        discovered = self._engine.discover(self.url)
        if not discovered:
            logger.warning("[api-discovery] No API found for %s", self.url)
            return []

        logger.info(
            "[api-discovery] %s -> %s via %s",
            self.url,
            discovered.ats_type,
            discovered.source,
        )

        dispatcher = {
            "greenhouse": self._parse_greenhouse,
            "lever": self._parse_lever,
            "workday": self._parse_workday,
            "ashby": self._parse_ashby,
            "smartrecruiters": self._parse_smartrecruiters,
            "workable": self._parse_workable,
            "recruitee": self._parse_recruitee,
            "bamboohr": self._parse_bamboohr,
            "breezy": self._parse_breezy,
            "pinpoint": self._parse_pinpoint,
            "jobvite": self._parse_jobvite,
            "generic_api": self._parse_generic,
        }

        parser_fn = dispatcher.get(discovered.ats_type, self._parse_generic)
        jobs = parser_fn(discovered)
        logger.info(
            "[api-discovery] %s -> %d jobs (ats=%s, source=%s)",
            self.url,
            len(jobs),
            discovered.ats_type,
            discovered.source,
        )
        return jobs

    def parse_job_listing(self, element: Any) -> Dict[str, Any]:
        """Not used — required by BaseScraper ABC only."""
        return {}

    # ------------------------------------------------------------------
    # Per-platform normalisers
    # ------------------------------------------------------------------

    def _parse_greenhouse(self, d: DiscoveredAPI) -> List[Dict[str, Any]]:
        data = self.fetch_json(d.api_url)
        if not data or "jobs" not in data:
            return []
        jobs: List[Dict[str, Any]] = []
        for item in data["jobs"]:
            meta = {
                m["name"]: m["value"]
                for m in item.get("metadata", [])
                if m.get("value")
            }
            jobs.append(
                self.normalize_job_data(
                    {
                        "title": item.get("title", ""),
                        "location": item.get("location", {}).get("name", ""),
                        "department": (
                            item.get("departments", [{}])[0].get("name", "")
                            if item.get("departments")
                            else ""
                        ),
                        "description": item.get("content", "")[:1000],
                        "url": item.get("absolute_url", ""),
                        "posted_date": item.get("updated_at"),
                        "experience": meta.get(
                            "experience_level", meta.get("seniority", "")
                        ),
                        "ats_type": "greenhouse",
                    }
                )
            )
        return jobs

    def _parse_lever(self, d: DiscoveredAPI) -> List[Dict[str, Any]]:
        data = self.fetch_json(d.api_url)
        if not data or not isinstance(data, list):
            return []
        jobs: List[Dict[str, Any]] = []
        for item in data:
            cats = item.get("categories", {})
            jobs.append(
                self.normalize_job_data(
                    {
                        "title": item.get("text", ""),
                        "location": cats.get("location", item.get("workplaceType", "")),
                        "department": cats.get("team", cats.get("department", "")),
                        "description": item.get(
                            "descriptionPlain", item.get("description", "")
                        )[:1000],
                        "url": item.get("hostedUrl", ""),
                        "posted_date": item.get("createdAt"),
                        "experience": cats.get("level", ""),
                        "ats_type": "lever",
                    }
                )
            )
        return jobs

    def _parse_workday(self, d: DiscoveredAPI) -> List[Dict[str, Any]]:
        all_jobs: List[Dict[str, Any]] = []
        offset, limit = 0, 20
        while True:
            resp = self.fetch_json(
                d.api_url,
                method="POST",
                json={
                    "appliedFacets": {},
                    "limit": limit,
                    "offset": offset,
                    "searchText": "",
                },
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
            )
            if not resp:
                break
            postings = resp.get("jobPostings", [])
            total = resp.get("total", 0)
            for item in postings:
                path = item.get("externalPath", "")
                all_jobs.append(
                    self.normalize_job_data(
                        {
                            "title": item.get("title", ""),
                            "location": item.get(
                                "locationsText", item.get("primaryLocation", "")
                            ),
                            "department": item.get("jobCategoryText", ""),
                            "url": urljoin(self.url, path) if path else "",
                            "posted_date": item.get("postedOn"),
                            "ats_type": "workday",
                        }
                    )
                )
            offset += limit
            if offset >= total or not postings:
                break
        return all_jobs

    def _parse_ashby(self, d: DiscoveredAPI) -> List[Dict[str, Any]]:
        data = self.fetch_json(d.api_url)
        if not data:
            return []
        postings = data.get("jobPostings", data if isinstance(data, list) else [])
        jobs: List[Dict[str, Any]] = []
        for item in postings:
            loc = item.get("locationName", "") or item.get("location", {})
            jobs.append(
                self.normalize_job_data(
                    {
                        "title": item.get("title", ""),
                        "location": (
                            loc if isinstance(loc, str) else loc.get("city", "")
                        ),
                        "department": item.get("departmentName", ""),
                        "description": item.get("descriptionHtml", "")[:1000],
                        "url": item.get("jobUrl", item.get("applyUrl", "")),
                        "posted_date": item.get("publishedAt"),
                        "experience": item.get("employmentType", ""),
                        "ats_type": "ashby",
                    }
                )
            )
        return jobs

    def _parse_smartrecruiters(self, d: DiscoveredAPI) -> List[Dict[str, Any]]:
        all_jobs: List[Dict[str, Any]] = []
        offset, limit = 0, 100
        base = d.api_url.split("?")[0]
        while True:
            data = self.fetch_json(f"{base}?limit={limit}&offset={offset}")
            if not data or "content" not in data:
                break
            for item in data["content"]:
                loc = item.get("location", {})
                all_jobs.append(
                    self.normalize_job_data(
                        {
                            "title": item.get("name", ""),
                            "location": f"{loc.get('city', '')} {loc.get('country', '')}".strip(),
                            "department": item.get("department", {}).get("label", ""),
                            "url": item.get("ref", ""),
                            "posted_date": item.get("releasedDate"),
                            "experience": item.get("experienceLevel", ""),
                            "ats_type": "smartrecruiters",
                        }
                    )
                )
            total = data.get("totalFound", 0)
            offset += limit
            if offset >= total:
                break
        return all_jobs

    def _parse_workable(self, d: DiscoveredAPI) -> List[Dict[str, Any]]:
        data = self.fetch_json(
            d.api_url,
            method="POST",
            json={
                "query": "",
                "location": [],
                "department": [],
                "worktype": [],
                "remote": [],
            },
            headers={"Content-Type": "application/json"},
        )
        if not data:
            data = self.fetch_json(d.api_url)
        if not data:
            return []
        results = data.get("results", data.get("jobs", []))
        jobs: List[Dict[str, Any]] = []
        for item in results:
            loc = item.get("location", {})
            jobs.append(
                self.normalize_job_data(
                    {
                        "title": item.get("title", ""),
                        "location": (
                            loc.get("city", "") if isinstance(loc, dict) else str(loc)
                        ),
                        "department": item.get("department", ""),
                        "url": item.get("url", item.get("shortlink", "")),
                        "posted_date": item.get("published_on"),
                        "ats_type": "workable",
                    }
                )
            )
        return jobs

    def _parse_recruitee(self, d: DiscoveredAPI) -> List[Dict[str, Any]]:
        data = self.fetch_json(d.api_url)
        if not data or "offers" not in data:
            return []
        jobs: List[Dict[str, Any]] = []
        for item in data["offers"]:
            jobs.append(
                self.normalize_job_data(
                    {
                        "title": item.get("title", ""),
                        "location": item.get("city", ""),
                        "department": item.get("department", ""),
                        "description": item.get("description", "")[:1000],
                        "url": item.get("careers_url", ""),
                        "posted_date": item.get("published_at"),
                        "ats_type": "recruitee",
                    }
                )
            )
        return jobs

    def _parse_bamboohr(self, d: DiscoveredAPI) -> List[Dict[str, Any]]:
        data = self.fetch_json(d.api_url, headers={"Accept": "application/json"})
        if not data:
            return []
        positions = data.get("result", data.get("positions", []))
        slug = d.token
        jobs: List[Dict[str, Any]] = []
        for item in positions:
            loc = item.get("location", {})
            jobs.append(
                self.normalize_job_data(
                    {
                        "title": item.get("jobOpeningName", item.get("title", "")),
                        "location": (
                            loc.get("city", "") if isinstance(loc, dict) else str(loc)
                        ),
                        "department": item.get("departmentLabel", ""),
                        "url": f"https://{slug}.bamboohr.com/careers/{item.get('jobId', '')}",
                        "ats_type": "bamboohr",
                    }
                )
            )
        return jobs

    def _parse_breezy(self, d: DiscoveredAPI) -> List[Dict[str, Any]]:
        data = self.fetch_json(d.api_url)
        if not data or not isinstance(data, list):
            return []
        jobs: List[Dict[str, Any]] = []
        for item in data:
            loc = item.get("location", {})
            location = (
                f"{loc.get('city', '')} {loc.get('country', '')}".strip()
                if isinstance(loc, dict)
                else str(loc)
            )
            jobs.append(
                self.normalize_job_data(
                    {
                        "title": item.get("name", ""),
                        "location": location,
                        "department": (
                            item.get("department", {}).get("name", "")
                            if isinstance(item.get("department"), dict)
                            else ""
                        ),
                        "description": item.get("description", "")[:1000],
                        "url": item.get("url", ""),
                        "ats_type": "breezy",
                    }
                )
            )
        return jobs

    def _parse_pinpoint(self, d: DiscoveredAPI) -> List[Dict[str, Any]]:
        data = self.fetch_json(d.api_url)
        if not data:
            return []
        items = (
            data if isinstance(data, list) else data.get("data", data.get("jobs", []))
        )
        jobs: List[Dict[str, Any]] = []
        for item in items:
            attr = item.get("attributes", item)
            jobs.append(
                self.normalize_job_data(
                    {
                        "title": attr.get("title", ""),
                        "location": attr.get("location", ""),
                        "department": attr.get("team", ""),
                        "description": attr.get("description", "")[:1000],
                        "url": attr.get("apply_url", attr.get("url", "")),
                        "posted_date": attr.get("published_at"),
                        "ats_type": "pinpoint",
                    }
                )
            )
        return jobs

    def _parse_jobvite(self, d: DiscoveredAPI) -> List[Dict[str, Any]]:
        data = self.fetch_json(d.api_url)
        if not data:
            return []
        items = data.get("jobs", data if isinstance(data, list) else [])
        jobs: List[Dict[str, Any]] = []
        for item in items:
            jobs.append(
                self.normalize_job_data(
                    {
                        "title": item.get("title", ""),
                        "location": item.get("location", ""),
                        "department": item.get("categories", {}).get("department", ""),
                        "description": item.get("briefDescription", "")[:1000],
                        "url": item.get("applyLink", item.get("jobUrl", "")),
                        "posted_date": item.get("date"),
                        "ats_type": "jobvite",
                    }
                )
            )
        return jobs

    def _parse_generic(self, d: DiscoveredAPI) -> List[Dict[str, Any]]:
        """Lightweight normaliser for any JSON array/object from a discovered API."""
        data = self.fetch_json(d.api_url)
        if not data:
            return []

        envelope_keys = [
            "jobs",
            "results",
            "data",
            "postings",
            "positions",
            "offers",
            "items",
        ]
        items = data if isinstance(data, list) else None
        if items is None:
            for key in envelope_keys:
                if key in data and isinstance(data[key], list):
                    items = data[key]
                    break
        if not items:
            return []

        jobs: List[Dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            title = (
                item.get("title")
                or item.get("name")
                or item.get("job_title")
                or item.get("jobTitle")
                or item.get("text")
                or ""
            )
            if not title:
                continue
            location = (
                item.get("location")
                or item.get("city")
                or item.get("office")
                or item.get("locationText")
                or ""
            )
            if isinstance(location, dict):
                location = location.get("name", location.get("city", ""))
            url = (
                item.get("url")
                or item.get("applyUrl")
                or item.get("apply_url")
                or item.get("absolute_url")
                or item.get("hostedUrl")
                or item.get("link")
                or item.get("jobUrl")
                or ""
            )
            jobs.append(
                self.normalize_job_data(
                    {
                        "title": truncate_text(clean_whitespace(str(title)), 200),
                        "location": truncate_text(clean_whitespace(str(location)), 200),
                        "department": str(item.get("department", item.get("team", ""))),
                        "description": truncate_text(
                            str(item.get("description", item.get("summary", ""))), 1000
                        ),
                        "url": str(url),
                        "posted_date": item.get("createdAt")
                        or item.get("posted_date")
                        or item.get("publishedAt"),
                        "ats_type": d.ats_type,
                    }
                )
            )
        return jobs
