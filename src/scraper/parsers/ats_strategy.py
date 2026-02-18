"""
ATS Strategy Pattern.

Each strategy:
  1. Declares whether it can handle a given URL/HTML (matches()).
  2. Returns standardised job dicts when it can (parse()).
  3. Returns None / empty list on any failure so the orchestrator can
     fall back gracefully to the GenericCareerParser.

Add new ATS strategies by subclassing ATSStrategy and registering them
in REGISTRY at the bottom of this file.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from src.scraper.base_scraper import BaseScraper, ScraperConfig

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Abstract strategy
# ---------------------------------------------------------------------------


class ATSStrategy(ABC):
    """
    Interface for ATS-specific parsing strategies.

    Implementations are stateless — they receive a BaseScraper instance
    for HTTP and HTML helpers rather than inheriting from it.
    """

    name: str = "base"

    @abstractmethod
    def matches(self, url: str, html: str) -> bool:
        """
        Return True if this strategy can handle the given page.

        Args:
            url: The career page URL.
            html: Raw HTML content of the page (may be empty string).
        """

    @abstractmethod
    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        """
        Scrape jobs from the page.

        Args:
            url: Career page URL.
            scraper: BaseScraper instance for HTTP helpers.

        Returns:
            List of normalised job dicts, or empty list on failure.
        """


# ---------------------------------------------------------------------------
# Greenhouse
# ---------------------------------------------------------------------------


class GreenhouseStrategy(ATSStrategy):
    """
    Optimised strategy for Greenhouse-hosted career pages.

    Prefers the JSON API endpoint (/embed/jobs.json) for clean data,
    falls back to HTML CSS selectors.
    """

    name = "greenhouse"

    def matches(self, url: str, html: str) -> bool:
        return "greenhouse.io" in url or "boards.greenhouse.io" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        jobs: List[Dict[str, Any]] = []

        # ---- Try JSON API ----
        api_url = urljoin(url.rstrip("/") + "/", "embed/jobs.json")
        data = scraper.fetch_json(api_url)
        if data and "jobs" in data:
            for item in data["jobs"]:
                jobs.append(scraper.normalize_job_data({
                    "title":      item.get("title", ""),
                    "location":   item.get("location", {}).get("name", ""),
                    "department": item.get("departments", [{}])[0].get("name", "") if item.get("departments") else "",
                    "url":        item.get("absolute_url", ""),
                    "ats_type":   self.name,
                }))
            logger.info("Greenhouse JSON API: %d jobs from %s", len(jobs), url)
            return jobs

        # ---- HTML fallback ----
        soup = scraper.fetch_page(url)
        if not soup:
            return []

        for el in soup.select(".opening"):
            title    = scraper.extract_text(el, "h3, a")
            location = scraper.extract_text(el, ".location")
            dept     = scraper.extract_text(el, ".department")
            href     = scraper.extract_attribute(el, "a", "href")
            if href and not href.startswith("http"):
                href = urljoin(url, href)
            if title:
                jobs.append(scraper.normalize_job_data({
                    "title": title, "location": location,
                    "department": dept, "url": href, "ats_type": self.name,
                }))

        logger.info("Greenhouse HTML: %d jobs from %s", len(jobs), url)
        return jobs


# ---------------------------------------------------------------------------
# Lever
# ---------------------------------------------------------------------------


class LeverStrategy(ATSStrategy):
    """
    Optimised strategy for Lever-hosted career pages.

    Prefers the JSON API (/postings?format=json), falls back to HTML.
    """

    name = "lever"

    def matches(self, url: str, html: str) -> bool:
        return "lever.co" in url or "jobs.lever.co" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        jobs: List[Dict[str, Any]] = []
        base = url.rstrip("/")

        # ---- Try JSON API ----
        api_url = f"{base}?format=json"
        data = scraper.fetch_json(api_url)
        if data and isinstance(data, list):
            for item in data:
                cats = item.get("categories", {})
                jobs.append(scraper.normalize_job_data({
                    "title":      item.get("text", ""),
                    "location":   cats.get("location", ""),
                    "department": cats.get("team", ""),
                    "url":        item.get("hostedUrl", ""),
                    "ats_type":   self.name,
                }))
            logger.info("Lever JSON API: %d jobs from %s", len(jobs), url)
            return jobs

        # ---- HTML fallback ----
        soup = scraper.fetch_page(url)
        if not soup:
            return []

        for el in soup.select(".posting"):
            title  = scraper.extract_text(el, ".posting-title h5, .posting-title")
            loc    = scraper.extract_text(el, ".posting-categories .location")
            dept   = scraper.extract_text(el, ".posting-categories .department, .posting-categories .team")
            href   = scraper.extract_attribute(el, "a", "href")
            if href and not href.startswith("http"):
                href = urljoin(url, href)
            if title:
                jobs.append(scraper.normalize_job_data({
                    "title": title, "location": loc,
                    "department": dept, "url": href, "ats_type": self.name,
                }))

        logger.info("Lever HTML: %d jobs from %s", len(jobs), url)
        return jobs


# ---------------------------------------------------------------------------
# Workday
# ---------------------------------------------------------------------------


class WorkdayStrategy(ATSStrategy):
    """
    Strategy for Workday career pages.

    Note: Workday is heavily JavaScript-rendered; this HTML approach may
    miss some postings. Consider adding a Playwright integration for full
    coverage in a future iteration.
    """

    name = "workday"

    def matches(self, url: str, html: str) -> bool:
        return "myworkdayjobs.com" in url or "workday.com" in url

    def parse(self, url: str, scraper: BaseScraper) -> List[Dict[str, Any]]:
        soup = scraper.fetch_page(url)
        if not soup:
            return []

        jobs: List[Dict[str, Any]] = []
        selectors = (
            '[data-automation-id="compositeContainer"] li, '
            '.jobResultItem, [data-automation-id="jobTitle"]'
        )

        for el in soup.select(selectors):
            title = scraper.extract_text(el, '[data-automation-id="jobTitle"], .jobTitle, h3, a')
            loc   = scraper.extract_text(el, '[data-automation-id="locations"], .jobLocation')
            href  = scraper.extract_attribute(el, "a", "href")
            if href and not href.startswith("http"):
                href = urljoin(url, href)
            if title:
                jobs.append(scraper.normalize_job_data({
                    "title": title, "location": loc,
                    "url": href, "ats_type": self.name,
                }))

        logger.info("Workday HTML: %d jobs from %s", len(jobs), url)
        return jobs


# ---------------------------------------------------------------------------
# Strategy registry — add new strategies here
# ---------------------------------------------------------------------------

REGISTRY: List[ATSStrategy] = [
    GreenhouseStrategy(),
    LeverStrategy(),
    WorkdayStrategy(),
]


def get_strategy(url: str, html: str = "") -> Optional[ATSStrategy]:
    """
    Return the first matching strategy for *url*, or None if none match.

    Args:
        url: Career page URL.
        html: Optional raw HTML for content-based matching.

    Returns:
        Matched ATSStrategy instance or None.
    """
    for strategy in REGISTRY:
        if strategy.matches(url, html):
            logger.debug("Strategy matched: %s → %s", strategy.name, url)
            return strategy
    return None
