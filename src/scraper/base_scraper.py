"""
HTTP base scraper — reused from Scraper/base_scraper.py.

Provides ScraperConfig, session management, retry logic, HTML/JSON fetch,
and common CSS extraction helpers. Platform-specific scrapers extend BaseScraper.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


class ScraperConfig:
    """HTTP-level configuration shared by all scrapers."""

    def __init__(
        self,
        timeout: int = 30,
        max_retries: int = 3,
        retry_delay: int = 2,
        user_agent: str = (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        extra_headers: Optional[Dict[str, str]] = None,
        verify_ssl: bool = True,
        rate_limit_delay: float = 2.0,
    ) -> None:
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.user_agent = user_agent
        self.extra_headers = extra_headers or {}
        self.verify_ssl = verify_ssl
        self.rate_limit_delay = rate_limit_delay

    def get_headers(self) -> Dict[str, str]:
        base = {
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
        }
        base.update(self.extra_headers)
        return base


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


class BaseScraper(ABC):
    """
    Abstract base class for all career-page scrapers.

    Provides:
    - Shared requests.Session with retry + rate-limiting.
    - fetch_page() / fetch_json() helpers.
    - CSS extraction helpers (extract_text, extract_attribute).
    - normalize_job_data() for a standard output shape.

    Subclasses must implement:
    - scrape_jobs(**kwargs) -> List[Dict[str, Any]]
    - parse_job_listing(element) -> Dict[str, Any]
    """

    def __init__(self, config: Optional[ScraperConfig] = None) -> None:
        self.config = config or ScraperConfig()
        self.session = requests.Session()
        self.session.headers.update(self.config.get_headers())
        self._last_request_time: float = 0

    # ------------------------------------------------------------------
    # Internal HTTP helpers
    # ------------------------------------------------------------------

    def _rate_limit(self) -> None:
        elapsed = time.time() - self._last_request_time
        if elapsed < self.config.rate_limit_delay:
            time.sleep(self.config.rate_limit_delay - elapsed)
        self._last_request_time = time.time()

    def _make_request(
        self, url: str, method: str = "GET", **kwargs
    ) -> Optional[requests.Response]:
        self._rate_limit()
        for attempt in range(1, self.config.max_retries + 1):
            try:
                logger.debug(
                    "Fetching %s (attempt %d/%d)", url, attempt, self.config.max_retries
                )
                resp = self.session.request(
                    method.upper(),
                    url,
                    timeout=self.config.timeout,
                    verify=self.config.verify_ssl,
                    **kwargs,
                )
                resp.raise_for_status()
                return resp
            except requests.RequestException as exc:
                logger.warning("Request failed (%s): %s", url, exc)
                if attempt < self.config.max_retries:
                    time.sleep(self.config.retry_delay * attempt)
        logger.error("Giving up on %s after %d attempts", url, self.config.max_retries)
        return None

    # ------------------------------------------------------------------
    # Public fetch helpers
    # ------------------------------------------------------------------

    def fetch_page(self, url: str) -> Optional[BeautifulSoup]:
        """Fetch *url* and return a BeautifulSoup object, or None on failure."""
        resp = self._make_request(url)
        return BeautifulSoup(resp.content, "html.parser") if resp else None

    def fetch_json(self, url: str, method: str = "GET", **kwargs) -> Optional[Dict]:
        """Fetch JSON from *url*, return parsed dict or None."""
        resp = self._make_request(url, method, **kwargs)
        if resp:
            try:
                return resp.json()
            except Exception as exc:
                logger.error("JSON decode failed for %s: %s", url, exc)
        return None

    # ------------------------------------------------------------------
    # CSS extraction helpers
    # ------------------------------------------------------------------

    def extract_text(self, element: Any, selector: str, default: str = "") -> str:
        """Return stripped text of the first element matching *selector*."""
        try:
            found = element.select_one(selector)
            return found.get_text(strip=True) if found else default
        except Exception:
            return default

    def extract_attribute(
        self, element: Any, selector: str, attribute: str, default: str = ""
    ) -> str:
        """Return attribute value of the first element matching *selector*."""
        try:
            found = element.select_one(selector)
            return found.get(attribute, default) if found else default
        except Exception:
            return default

    # ------------------------------------------------------------------
    # Normaliser — shapes raw dicts to a common structure
    # ------------------------------------------------------------------

    def normalize_job_data(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        """Return a standardised job dict from a raw scraped dict."""
        return {
            "title": raw.get("title", ""),
            "company": raw.get("company", ""),
            "location": raw.get("location", ""),
            "department": raw.get("department", ""),
            "experience": raw.get("experience", ""),
            "description": raw.get("description", ""),
            "url": raw.get("url", ""),
            "posted_date": raw.get("posted_date"),
            "ats_type": raw.get("ats_type", "unknown"),
        }

    # ------------------------------------------------------------------
    # Interface
    # ------------------------------------------------------------------

    @abstractmethod
    def scrape_jobs(self, **kwargs) -> List[Dict[str, Any]]:
        """Scrape job listings from the career page."""

    @abstractmethod
    def parse_job_listing(self, element: Any) -> Dict[str, Any]:
        """Parse a single job listing element into a raw dict."""

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    def close(self) -> None:
        self.session.close()

    def __enter__(self) -> "BaseScraper":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
