"""
Career Page Scraper Orchestrator.

Ties together:
  - ATS strategies (Greenhouse, Lever, Workday, …)
  - Generic / universal fallback parser
  - Database upsert
  - Per-URL concurrency via ThreadPoolExecutor

Usage:
    scraper = CareerPageScraper(db_client, settings.scraper)
    report  = scraper.scrape_all(url_list)
"""

from __future__ import annotations

import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from src.config.settings import ScraperSettings
from src.database.models import Company, Job, ScrapeHistory
from src.database.mongodb_client import MongoDBClient
from src.scraper.base_scraper import ScraperConfig
from src.scraper.generic_parser import GenericCareerParser
from src.scraper.parsers.ats_strategy import ATSStrategy, get_strategy
from src.utils.helpers import extract_domain, generate_job_id

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Scrape report dataclass (plain dict, no extra dep)
# ---------------------------------------------------------------------------


def _empty_report() -> Dict[str, Any]:
    return {
        "scrape_id":        "",
        "urls_attempted":   0,
        "urls_succeeded":   0,
        "jobs_found":       0,
        "new_jobs":         0,
        "errors":           [],
        "parser_usage":     {},   # url → "greenhouse" | "universal" | …
        "duration_seconds": 0.0,
    }


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


class CareerPageScraper:
    """
    Orchestrates scraping of multiple career pages.

    Strategy selection order per URL:
      1. Try each ATSStrategy.matches() in REGISTRY order.
      2. If a matching strategy exists, call strategy.parse().
      3. On strategy failure (exception or empty result), fall back.
      4. Fallback: GenericCareerParser.

    All results are upserted into MongoDB and compared against the
    previous scrape to mark genuinely new postings.
    """

    def __init__(
        self,
        db_client: MongoDBClient,
        settings: ScraperSettings,
    ) -> None:
        self._db = db_client
        self._settings = settings

        # Build shared HTTP config
        self._http_config = ScraperConfig(
            timeout=settings.timeout,
            max_retries=settings.max_retries,
            retry_delay=settings.retry_delay,
            user_agent=settings.user_agent,
            rate_limit_delay=settings.rate_limit_delay,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def scrape_all(self, urls: List[str]) -> Dict[str, Any]:
        """
        Scrape all *urls* concurrently and persist results.

        Args:
            urls: List of career page URLs to scrape.

        Returns:
            Scrape report dict.
        """
        report = _empty_report()
        report["scrape_id"] = str(uuid.uuid4())
        report["urls_attempted"] = len(urls)
        start = time.time()

        workers = min(self._settings.concurrent_requests, len(urls))
        results: List[Tuple[str, List[Dict[str, Any]], str]] = []   # (url, jobs, parser)

        with ThreadPoolExecutor(max_workers=workers) as pool:
            future_map = {pool.submit(self._scrape_single, url): url for url in urls}
            for future in as_completed(future_map):
                url = future_map[future]
                try:
                    jobs, parser_name = future.result()
                    results.append((url, jobs, parser_name))
                    report["urls_succeeded"] += 1
                    report["parser_usage"][url] = parser_name
                except Exception as exc:
                    logger.error("Scrape failed for %s: %s", url, exc)
                    report["errors"].append(f"{url}: {exc}")

        # Persist & count new jobs
        for url, jobs, _ in results:
            company_name = extract_domain(url)
            new_count = self._persist_jobs(jobs, company_name, url)
            report["jobs_found"] += len(jobs)
            report["new_jobs"] += new_count

        report["duration_seconds"] = round(time.time() - start, 2)

        # Save scrape history
        history = ScrapeHistory(
            scrape_id=report["scrape_id"],
            companies_scraped=report["urls_succeeded"],
            jobs_found=report["jobs_found"],
            new_jobs=report["new_jobs"],
            errors=report["errors"],
            duration_seconds=report["duration_seconds"],
        )
        self._db.insert_scrape_history(history)

        self._log_report(report)
        return report

    def scrape_single_url(self, url: str) -> Tuple[List[Dict[str, Any]], str]:
        """
        Scrape a single URL (public convenience wrapper).

        Returns:
            Tuple of (job_list, parser_name_used).
        """
        return self._scrape_single(url)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _scrape_single(self, url: str) -> Tuple[List[Dict[str, Any]], str]:
        """
        Attempt ATS strategy first; fall back to generic parser.

        Returns:
            (jobs, parser_name)
        """
        # ---- ATS strategy ----
        if self._settings.enable_ats_strategies:
            strategy = get_strategy(url)
            if strategy:
                try:
                    generic = GenericCareerParser(url, config=self._http_config,
                                                  min_confidence=self._settings.min_confidence)
                    jobs = strategy.parse(url, generic)
                    if jobs:
                        logger.info("[%s] %s → %d jobs", strategy.name, url, len(jobs))
                        return jobs, strategy.name
                    logger.warning("[%s] no jobs returned for %s — falling back", strategy.name, url)
                except Exception as exc:
                    logger.warning("[%s] strategy error for %s: %s — falling back", strategy.name, url, exc)

        # ---- Generic parser ----
        parser = GenericCareerParser(url, config=self._http_config,
                                     min_confidence=self._settings.min_confidence)
        jobs = parser.scrape_jobs()
        logger.info("[universal] %s → %d jobs", url, len(jobs))
        return jobs, "universal"

    def _persist_jobs(
        self, raw_jobs: List[Dict[str, Any]], company: str, source_url: str
    ) -> int:
        """
        Upsert jobs into MongoDB and return the count of genuinely new ones.
        """
        new_count = 0
        for raw in raw_jobs:
            if not raw.get("title"):
                continue
            job_id = generate_job_id(company, raw["title"], raw.get("url", source_url))
            is_existing = self._db.job_exists(job_id)

            job = Job(
                id=job_id,
                company=company,
                title=raw.get("title", ""),
                location=raw.get("location", ""),
                department=raw.get("department", ""),
                experience=raw.get("experience", ""),
                description=raw.get("description", ""),
                url=raw.get("url", source_url),
                ats_type=raw.get("ats_type", "unknown"),
                is_new=not is_existing,
            )
            self._db.upsert_job(job)

            if not is_existing:
                new_count += 1

        # Update company record
        self._db.upsert_company(Company(
            name=company,
            career_page_url=source_url,
            last_scraped=datetime.utcnow(),
            total_jobs=len(raw_jobs),
        ))

        return new_count

    @staticmethod
    def _log_report(report: Dict[str, Any]) -> None:
        logger.info(
            "Scrape complete | id=%s | urls=%d/%d | jobs=%d (new=%d) | %.1fs",
            report["scrape_id"],
            report["urls_succeeded"],
            report["urls_attempted"],
            report["jobs_found"],
            report["new_jobs"],
            report["duration_seconds"],
        )
        if report["errors"]:
            logger.warning("%d URL(s) failed: %s", len(report["errors"]), report["errors"])
