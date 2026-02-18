"""
Generic Career Page Parser.

Works on ANY career page with no prior knowledge. Uses the existing
JobPatternDetector heuristics to auto-detect job containers and field
selectors, then extracts and normalises job data.

This is the PRIMARY parser — all ATS strategies fall back to this.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from src.scraper.base_scraper import BaseScraper, ScraperConfig
from src.scraper.pattern_detector import JobPatternDetector
from src.utils.helpers import clean_whitespace, truncate_text

logger = logging.getLogger(__name__)


class GenericCareerParser(BaseScraper):
    """
    Heuristic-driven scraper that handles any career page structure.

    Pattern detection is cached after the first successful page load so
    subsequent pages (pagination) skip the expensive detection step.
    """

    def __init__(
        self,
        url: str,
        config: Optional[ScraperConfig] = None,
        min_confidence: float = 0.6,
    ) -> None:
        super().__init__(config)
        self.url = url.rstrip("/")
        self.min_confidence = min_confidence
        self._detector = JobPatternDetector(min_confidence=min_confidence)

        # Cached pattern state
        self._container_selector: Optional[str] = None
        self._field_selectors: Dict[str, str] = {}
        self._patterns_detected: bool = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def scrape_jobs(self, max_pages: int = 1, **kwargs) -> List[Dict[str, Any]]:
        """
        Scrape all job listings from the career page.

        Args:
            max_pages: Maximum number of paginated pages to scrape.
            **kwargs: Ignored (kept for interface consistency).

        Returns:
            List of normalised job dicts.
        """
        all_jobs: List[Dict[str, Any]] = []

        for page in range(1, max_pages + 1):
            page_url = self._build_page_url(self.url, page)
            logger.info("Fetching page %d: %s", page, page_url)

            soup = self.fetch_page(page_url)
            if not soup:
                logger.warning("Failed to fetch %s — stopping pagination", page_url)
                break

            if not self._patterns_detected:
                self._detect_patterns(soup)

            jobs = self._extract_jobs(soup)
            if not jobs:
                logger.info("No jobs on page %d — stopping pagination", page)
                break

            all_jobs.extend(jobs)
            logger.info("Found %d jobs on page %d", len(jobs), page)

            # Stop if no next page
            if not self._has_next_page(soup):
                break

        logger.info("Total generic-parser jobs: %d from %s", len(all_jobs), self.url)
        return all_jobs

    def parse_job_listing(self, element: Any) -> Dict[str, Any]:
        """Extract raw fields from one job container element."""
        try:
            title = self._safe_text(element, self._field_selectors.get("title", "h3,h2,.title,a"))
            location = self._safe_text(element, self._field_selectors.get("location", '.location,[class*="location"]'))
            department = self._safe_text(element, self._field_selectors.get("department", '.department,[class*="department"]'))
            url = self._extract_url(element)
            description = truncate_text(clean_whitespace(element.get_text(separator=" ")), 600)

            return {
                "title": title,
                "location": location,
                "department": department,
                "description": description,
                "url": url,
                "ats_type": "universal",
            }
        except Exception as exc:
            logger.debug("Error parsing element: %s", exc)
            return {}

    def analyze_page(self) -> Dict[str, Any]:
        """Return detected patterns for a career page (useful for debugging)."""
        soup = self.fetch_page(self.url)
        if not soup:
            return {"error": "Failed to fetch page"}
        return self._detector.analyze_page_structure(soup)

    # ------------------------------------------------------------------
    # Pattern detection
    # ------------------------------------------------------------------

    def _detect_patterns(self, soup: BeautifulSoup) -> None:
        container_selector, confidence = self._detector.detect_job_container(soup)
        if container_selector:
            self._container_selector = container_selector
            containers = soup.select(container_selector)[:10]
            field_map = self._detector.detect_field_selectors(containers)
            self._field_selectors = {
                field: selector for field, (selector, _) in field_map.items()
            }
            self._patterns_detected = True
            logger.debug(
                "Patterns detected — container: %s | fields: %s | confidence: %.2f",
                container_selector, list(self._field_selectors), confidence,
            )
        else:
            logger.warning("Pattern detection failed for %s", self.url)
            self._patterns_detected = False

    # ------------------------------------------------------------------
    # Extraction helpers
    # ------------------------------------------------------------------

    def _extract_jobs(self, soup: BeautifulSoup) -> List[Dict[str, Any]]:
        if not self._container_selector:
            return self._fallback_extraction(soup)

        jobs = []
        for element in soup.select(self._container_selector):
            raw = self.parse_job_listing(element)
            if raw.get("title"):
                jobs.append(self.normalize_job_data(raw))
        return jobs

    def _fallback_extraction(self, soup: BeautifulSoup) -> List[Dict[str, Any]]:
        """Last-resort extraction: grab any <a> with job-like text."""
        logger.warning("Using fallback extraction for %s", self.url)
        jobs = []
        job_pattern = re.compile(
            r"\b(engineer|developer|manager|designer|analyst|scientist|lead|director|intern)\b",
            re.IGNORECASE,
        )
        seen: set = set()
        for tag in soup.find_all("a", href=True):
            text = tag.get_text(strip=True)
            if len(text) < 8 or len(text) > 120:
                continue
            if not job_pattern.search(text):
                continue
            href = tag["href"]
            if not href.startswith("http"):
                href = urljoin(self.url, href)
            if href in seen:
                continue
            seen.add(href)
            jobs.append(self.normalize_job_data({
                "title": text,
                "url": href,
                "ats_type": "universal-fallback",
            }))
        return jobs

    def _safe_text(self, element: Any, selector: str, default: str = "") -> str:
        """Try multiple comma-separated selectors; return the first non-empty result."""
        for sel in [s.strip() for s in selector.split(",")]:
            try:
                found = element.select_one(sel)
                if found:
                    text = clean_whitespace(found.get_text())
                    if text:
                        return text
            except Exception:
                continue
        return default

    def _extract_url(self, element: Any) -> str:
        """Find the most relevant URL inside a job element."""
        links = element.find_all("a", href=True)
        if not links:
            return ""
        # Prefer the largest-text link (likely the job title link)
        best = max(links, key=lambda a: len(a.get_text(strip=True)), default=links[0])
        href = best["href"]
        if not href.startswith("http"):
            href = urljoin(self.url, href)
        return href

    def _has_next_page(self, soup: BeautifulSoup) -> bool:
        """Detect pagination 'next' link."""
        for selector in ["a[rel='next']", 'a:contains("Next")', '.pagination .next', '[aria-label="Next page"]']:
            if soup.select_one(selector):
                return True
        return False

    @staticmethod
    def _build_page_url(base_url: str, page: int) -> str:
        if page == 1:
            return base_url
        sep = "&" if "?" in base_url else "?"
        return f"{base_url}{sep}page={page}"
