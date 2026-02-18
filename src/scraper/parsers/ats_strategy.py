"""
ATS Strategy Pattern — API-only edition.

Every strategy calls a JSON REST API — no HTML scraping, no CSS selectors,
no browser automation.

Adding a new platform:
  1. Subclass ATSStrategy.
  2. Implement matches() and parse().
  3. Append an instance to REGISTRY at the bottom of this file.
"""

from __future__ import annotations

import logging
import re
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

from src.scraper.api_discovery import APIDiscoveryEngine, DiscoveredAPI
from src.scraper.base_scraper import BaseScraper, ScraperConfig

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


class ATSStrategy(ABC):
    """Stateless interface for ATS-specific API parsing strategies."""

    name: str = "base"

    @abstractmethod
    def matches(self, url: str, html: str = "") -> bool:
        """Return True if this strategy can handle url."""

    @abstractmethod
    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        """Return normalised job dicts — return [] on any failure."""


# ---------------------------------------------------------------------------
# Greenhouse  (boards-api.greenhouse.io/v1)
# ---------------------------------------------------------------------------


class GreenhouseStrategy(ATSStrategy):
    """Greenhouse JSON API v1. Endpoint: /v1/boards/{token}/jobs?content=true"""

    name = "greenhouse"

    def matches(self, url: str, html: str = "") -> bool:
        return "greenhouse.io" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        m = re.search(r"boards\.greenhouse\.io/([A-Za-z0-9_-]+)", url)
        if not m:
            m = re.search(r"[?&]for=([A-Za-z0-9_-]+)", url, re.IGNORECASE)
        if not m:
            engine = APIDiscoveryEngine(
                session=scraper.session, timeout=scraper.config.timeout
            )
            discovered = engine.discover(url)
            if not discovered or discovered.ats_type != "greenhouse":
                return []
            api_url = discovered.api_url
        else:
            token = m.group(1)
            api_url = (
                f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
            )

        data = scraper.fetch_json(api_url)
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
                scraper.normalize_job_data(
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
                        "ats_type": self.name,
                    }
                )
            )
        logger.info("Greenhouse API: %d jobs from %s", len(jobs), api_url)
        return jobs


# ---------------------------------------------------------------------------
# Lever  (api.lever.co/v0)
# ---------------------------------------------------------------------------


class LeverStrategy(ATSStrategy):
    """Lever JSON API v0. Endpoint: /v0/postings/{company}?mode=json"""

    name = "lever"

    def matches(self, url: str, html: str = "") -> bool:
        return "lever.co" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        m = re.search(r"jobs\.lever\.co/([A-Za-z0-9_-]+)", url)
        if not m:
            m = re.search(r"api\.lever\.co/v\d/postings/([A-Za-z0-9_-]+)", url)
        if not m:
            engine = APIDiscoveryEngine(
                session=scraper.session, timeout=scraper.config.timeout
            )
            discovered = engine.discover(url)
            if not discovered or discovered.ats_type != "lever":
                return []
            api_url = discovered.api_url
        else:
            slug = m.group(1)
            api_url = f"https://api.lever.co/v0/postings/{slug}?mode=json"

        data = scraper.fetch_json(api_url)
        if not data or not isinstance(data, list):
            return []
        jobs: List[Dict[str, Any]] = []
        for item in data:
            cats = item.get("categories", {})
            jobs.append(
                scraper.normalize_job_data(
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
                        "ats_type": self.name,
                    }
                )
            )
        logger.info("Lever API: %d jobs from %s", len(jobs), api_url)
        return jobs


# ---------------------------------------------------------------------------
# Workday  (POST myworkdayjobs.com/wday/cxs/tenant/site/jobs)
# ---------------------------------------------------------------------------


class WorkdayStrategy(ATSStrategy):
    """Workday Jobs Search API. Body: {appliedFacets,limit,offset,searchText}"""

    name = "workday"

    def matches(self, url: str, html: str = "") -> bool:
        return "myworkdayjobs.com" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        tenant_m = re.search(r"https?://([A-Za-z0-9_-]+)\.myworkdayjobs\.com", url)
        path_m = re.search(r"myworkdayjobs\.com/(?:[^/]+)/([A-Za-z0-9_-]+)", url)
        if not tenant_m or not path_m:
            engine = APIDiscoveryEngine(
                session=scraper.session, timeout=scraper.config.timeout
            )
            discovered = engine.discover(url)
            if not discovered or discovered.ats_type != "workday":
                return []
            api_url = discovered.api_url
        else:
            tenant = tenant_m.group(1)
            site = path_m.group(1)
            api_url = (
                f"https://{tenant}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"
            )

        all_jobs: List[Dict[str, Any]] = []
        offset, limit = 0, 20
        while True:
            resp = scraper.fetch_json(
                api_url,
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
                    scraper.normalize_job_data(
                        {
                            "title": item.get("title", ""),
                            "location": item.get(
                                "locationsText", item.get("primaryLocation", "")
                            ),
                            "department": item.get("jobCategoryText", ""),
                            "url": urljoin(url, path) if path else "",
                            "posted_date": item.get("postedOn"),
                            "ats_type": self.name,
                        }
                    )
                )
            offset += limit
            if offset >= total or not postings:
                break
        logger.info("Workday API: %d jobs from %s", len(all_jobs), api_url)
        return all_jobs


# ---------------------------------------------------------------------------
# Ashby  (api.ashbyhq.com/posting-api)
# ---------------------------------------------------------------------------


class AshbyStrategy(ATSStrategy):
    """Ashby public posting API. Endpoint: /posting-api/job-board/{slug}"""

    name = "ashby"

    def matches(self, url: str, html: str = "") -> bool:
        return "ashbyhq.com" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        m = re.search(r"jobs\.ashbyhq\.com/([A-Za-z0-9_-]+)", url)
        if m:
            slug = m.group(1)
            api_url = f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true"
        else:
            engine = APIDiscoveryEngine(
                session=scraper.session, timeout=scraper.config.timeout
            )
            discovered = engine.discover(url)
            if not discovered or discovered.ats_type != "ashby":
                return []
            api_url = discovered.api_url

        data = scraper.fetch_json(api_url)
        if not data:
            return []
        postings = data.get("jobPostings", data if isinstance(data, list) else [])
        jobs: List[Dict[str, Any]] = []
        for item in postings:
            loc = item.get("locationName", "") or item.get("location", {})
            jobs.append(
                scraper.normalize_job_data(
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
                        "ats_type": self.name,
                    }
                )
            )
        logger.info("Ashby API: %d jobs from %s", len(jobs), api_url)
        return jobs


# ---------------------------------------------------------------------------
# SmartRecruiters  (api.smartrecruiters.com/v1)
# ---------------------------------------------------------------------------


class SmartRecruitersStrategy(ATSStrategy):
    """SmartRecruiters postings API v1 with pagination."""

    name = "smartrecruiters"

    def matches(self, url: str, html: str = "") -> bool:
        return "smartrecruiters.com" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        m = re.search(r"careers\.smartrecruiters\.com/([A-Za-z0-9_-]+)", url)
        if m:
            slug = m.group(1)
            base = f"https://api.smartrecruiters.com/v1/companies/{slug}/postings"
        else:
            engine = APIDiscoveryEngine(
                session=scraper.session, timeout=scraper.config.timeout
            )
            discovered = engine.discover(url)
            if not discovered or discovered.ats_type != "smartrecruiters":
                return []
            base = discovered.api_url.split("?")[0]

        all_jobs: List[Dict[str, Any]] = []
        offset, limit = 0, 100
        while True:
            data = scraper.fetch_json(f"{base}?limit={limit}&offset={offset}")
            if not data or "content" not in data:
                break
            for item in data["content"]:
                loc = item.get("location", {})
                all_jobs.append(
                    scraper.normalize_job_data(
                        {
                            "title": item.get("name", ""),
                            "location": f"{loc.get('city', '')} {loc.get('country', '')}".strip(),
                            "department": item.get("department", {}).get("label", ""),
                            "url": item.get("ref", ""),
                            "posted_date": item.get("releasedDate"),
                            "experience": item.get("experienceLevel", ""),
                            "ats_type": self.name,
                        }
                    )
                )
            total = data.get("totalFound", 0)
            offset += limit
            if offset >= total:
                break
        logger.info("SmartRecruiters API: %d jobs from %s", len(all_jobs), base)
        return all_jobs


# ---------------------------------------------------------------------------
# Workable  (apply.workable.com/api/v3)
# ---------------------------------------------------------------------------


class WorkableStrategy(ATSStrategy):
    """Workable public jobs API v3."""

    name = "workable"

    def matches(self, url: str, html: str = "") -> bool:
        return "workable.com" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        m = re.search(r"(?:apply|careers)\.workable\.com/([A-Za-z0-9_-]+)", url)
        if m:
            slug = m.group(1)
            api_url = f"https://apply.workable.com/api/v3/accounts/{slug}/jobs"
        else:
            engine = APIDiscoveryEngine(
                session=scraper.session, timeout=scraper.config.timeout
            )
            discovered = engine.discover(url)
            if not discovered or discovered.ats_type != "workable":
                return []
            api_url = discovered.api_url

        data = scraper.fetch_json(
            api_url,
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
            data = scraper.fetch_json(api_url)
        if not data:
            return []
        results = data.get("results", data.get("jobs", []))
        jobs: List[Dict[str, Any]] = []
        for item in results:
            loc = item.get("location", {})
            jobs.append(
                scraper.normalize_job_data(
                    {
                        "title": item.get("title", ""),
                        "location": (
                            loc.get("city", "") if isinstance(loc, dict) else str(loc)
                        ),
                        "department": item.get("department", ""),
                        "url": item.get("url", item.get("shortlink", "")),
                        "posted_date": item.get("published_on", item.get("created_at")),
                        "ats_type": self.name,
                    }
                )
            )
        logger.info("Workable API: %d jobs from %s", len(jobs), api_url)
        return jobs


# ---------------------------------------------------------------------------
# Recruitee / BambooHR / Breezy / Pinpoint / Jobvite
# ---------------------------------------------------------------------------


class RecruiteeStrategy(ATSStrategy):
    name = "recruitee"

    def matches(self, url: str, html: str = "") -> bool:
        return "recruitee.com" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        m = re.search(r"([A-Za-z0-9_-]+)\.recruitee\.com", url)
        if not m:
            return []
        api_url = f"https://{m.group(1)}.recruitee.com/api/offers/"
        data = scraper.fetch_json(api_url)
        if not data or "offers" not in data:
            return []
        return [
            scraper.normalize_job_data(
                {
                    "title": i.get("title", ""),
                    "location": i.get("city", ""),
                    "department": i.get("department", ""),
                    "description": i.get("description", "")[:1000],
                    "url": i.get("careers_url", ""),
                    "posted_date": i.get("published_at"),
                    "ats_type": self.name,
                }
            )
            for i in data["offers"]
        ]


class BambooHRStrategy(ATSStrategy):
    name = "bamboohr"

    def matches(self, url: str, html: str = "") -> bool:
        return "bamboohr.com" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        m = re.search(r"([A-Za-z0-9_-]+)\.bamboohr\.com", url)
        if not m:
            return []
        slug = m.group(1)
        data = scraper.fetch_json(
            f"https://{slug}.bamboohr.com/careers/list",
            headers={"Accept": "application/json"},
        )
        if not data:
            return []
        positions = data.get("result", data.get("positions", []))
        jobs = []
        for item in positions:
            loc = item.get("location", {})
            jobs.append(
                scraper.normalize_job_data(
                    {
                        "title": item.get("jobOpeningName", item.get("title", "")),
                        "location": (
                            loc.get("city", "") if isinstance(loc, dict) else str(loc)
                        ),
                        "department": item.get("departmentLabel", ""),
                        "url": f"https://{slug}.bamboohr.com/careers/{item.get('jobId','')}",
                        "ats_type": self.name,
                    }
                )
            )
        return jobs


class BreezyStrategy(ATSStrategy):
    name = "breezy"

    def matches(self, url: str, html: str = "") -> bool:
        return "breezy.hr" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        m = re.search(r"([A-Za-z0-9_-]+)\.breezy\.hr", url)
        if not m:
            return []
        data = scraper.fetch_json(f"https://{m.group(1)}.breezy.hr/json")
        if not data or not isinstance(data, list):
            return []
        jobs = []
        for item in data:
            loc = item.get("location", {})
            location = (
                f"{loc.get('city','')} {loc.get('country','')}".strip()
                if isinstance(loc, dict)
                else str(loc)
            )
            jobs.append(
                scraper.normalize_job_data(
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
                        "ats_type": self.name,
                    }
                )
            )
        return jobs


class PinpointStrategy(ATSStrategy):
    name = "pinpoint"

    def matches(self, url: str, html: str = "") -> bool:
        return "pinpointhq.com" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        m = re.search(r"([A-Za-z0-9_-]+)\.pinpointhq\.com", url)
        if not m:
            return []
        data = scraper.fetch_json(
            f"https://{m.group(1)}.pinpointhq.com/api/v1/jobs.json"
        )
        if not data:
            return []
        items = (
            data if isinstance(data, list) else data.get("data", data.get("jobs", []))
        )
        return [
            scraper.normalize_job_data(
                {
                    "title": i.get("attributes", i).get("title", ""),
                    "location": i.get("attributes", i).get("location", ""),
                    "department": i.get("attributes", i).get("team", ""),
                    "url": i.get("attributes", i).get(
                        "apply_url", i.get("attributes", i).get("url", "")
                    ),
                    "posted_date": i.get("attributes", i).get("published_at"),
                    "ats_type": self.name,
                }
            )
            for i in items
        ]


class JobviteStrategy(ATSStrategy):
    name = "jobvite"

    def matches(self, url: str, html: str = "") -> bool:
        return "jobvite.com" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        m = re.search(r"jobs\.jobvite\.com/([A-Za-z0-9_-]+)", url)
        if not m:
            return []
        slug = m.group(1)
        data = scraper.fetch_json(
            f"https://api.jobvite.com/api/v2/job?companyId={slug}&api={slug}"
        )
        if not data:
            return []
        items = data.get("jobs", data if isinstance(data, list) else [])
        return [
            scraper.normalize_job_data(
                {
                    "title": i.get("title", ""),
                    "location": i.get("location", ""),
                    "department": i.get("categories", {}).get("department", ""),
                    "description": i.get("briefDescription", "")[:1000],
                    "url": i.get("applyLink", i.get("jobUrl", "")),
                    "posted_date": i.get("date"),
                    "ats_type": self.name,
                }
            )
            for i in items
        ]


# ---------------------------------------------------------------------------
# Registry — append new strategies here, no other changes needed
# ---------------------------------------------------------------------------

REGISTRY: List[ATSStrategy] = [
    GreenhouseStrategy(),
    LeverStrategy(),
    WorkdayStrategy(),
    AshbyStrategy(),
    SmartRecruitersStrategy(),
    WorkableStrategy(),
    RecruiteeStrategy(),
    BambooHRStrategy(),
    BreezyStrategy(),
    PinpointStrategy(),
    JobviteStrategy(),
]


def get_strategy(url: str, html: str = "") -> Optional[ATSStrategy]:
    """Return the first registered strategy matching url, or None."""
    for strategy in REGISTRY:
        if strategy.matches(url, html):
            logger.debug("Strategy matched: %s -> %s", strategy.name, url)
            return strategy
    return None
