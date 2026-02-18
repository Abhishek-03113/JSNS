"""
Career Page Scraper Implementations.

This module contains concrete implementations of career page scrapers
for different platforms.
"""

import logging
from typing import List, Dict, Any, Optional
from bs4 import BeautifulSoup
from urllib.parse import urljoin

from base_scraper import BaseScraper, ScraperConfig
from query_params import QueryBuilder, QueryParam

logger = logging.getLogger(__name__)


class GreenhouseScraper(BaseScraper):
    """Scraper for Greenhouse-powered career pages."""

    def __init__(self, company_url: str, config: Optional[ScraperConfig] = None):
        """
        Initialize Greenhouse scraper.

        Args:
            company_url: Base URL of the company's Greenhouse career page
            config: Scraper configuration
        """
        super().__init__(config)
        self.company_url = company_url.rstrip("/")
        self.platform = "greenhouse"

    def scrape_jobs(self, **kwargs) -> List[Dict[str, Any]]:
        """
        Scrape jobs from Greenhouse career page.

        Args:
            **kwargs: Query parameters (department, location, etc.)

        Returns:
            List of job dictionaries
        """
        # Build query URL
        query_builder = QueryBuilder(platform=self.platform)

        for key, value in kwargs.items():
            if hasattr(QueryParam, key.upper()):
                param = getattr(QueryParam, key.upper())
                query_builder.custom_param(param, value)

        url = query_builder.build_url(self.company_url)

        # Fetch the page
        soup = self.fetch_page(url)
        if not soup:
            return []

        # Parse job listings
        jobs = []
        job_elements = soup.select(".opening")

        for element in job_elements:
            job = self.parse_job_listing(element)
            if job:
                jobs.append(self.normalize_job_data(job))

        logger.info(f"Scraped {len(jobs)} jobs from Greenhouse")
        return jobs

    def parse_job_listing(self, element: BeautifulSoup) -> Dict[str, Any]:
        """Parse a Greenhouse job listing element."""
        try:
            title = self.extract_text(element, ".opening h3, .opening a")
            location = self.extract_text(element, ".location")
            department = self.extract_text(element, ".department")
            url = self.extract_attribute(element, "a", "href")

            if url and not url.startswith("http"):
                url = urljoin(self.company_url, url)

            return {
                "title": title,
                "location": location,
                "department": department,
                "url": url,
                "source_platform": "greenhouse",
                "raw_data": {"html": str(element)},
            }
        except Exception as e:
            logger.error(f"Failed to parse Greenhouse job listing: {e}")
            return {}


class LeverScraper(BaseScraper):
    """Scraper for Lever-powered career pages."""

    def __init__(self, company_url: str, config: Optional[ScraperConfig] = None):
        """
        Initialize Lever scraper.

        Args:
            company_url: Base URL of the company's Lever career page
            config: Scraper configuration
        """
        super().__init__(config)
        self.company_url = company_url.rstrip("/")
        self.platform = "lever"

    def scrape_jobs(self, **kwargs) -> List[Dict[str, Any]]:
        """
        Scrape jobs from Lever career page.

        Args:
            **kwargs: Query parameters

        Returns:
            List of job dictionaries
        """
        # Try API endpoint first
        api_url = f"{self.company_url}/postings"

        # Build query
        query_builder = QueryBuilder(platform=self.platform)
        for key, value in kwargs.items():
            if hasattr(QueryParam, key.upper()):
                param = getattr(QueryParam, key.upper())
                query_builder.custom_param(param, value)

        url = query_builder.build_url(api_url)

        # Try JSON API
        json_data = self.fetch_json(url)
        if json_data and isinstance(json_data, list):
            jobs = [self.parse_job_listing(job) for job in json_data]
            jobs = [self.normalize_job_data(job) for job in jobs if job]
            logger.info(f"Scraped {len(jobs)} jobs from Lever API")
            return jobs

        # Fallback to HTML parsing
        soup = self.fetch_page(url)
        if not soup:
            return []

        jobs = []
        job_elements = soup.select(".posting")

        for element in job_elements:
            job = self.parse_job_listing(element)
            if job:
                jobs.append(self.normalize_job_data(job))

        logger.info(f"Scraped {len(jobs)} jobs from Lever HTML")
        return jobs

    def parse_job_listing(self, element) -> Dict[str, Any]:
        """Parse a Lever job listing (HTML or JSON)."""
        try:
            # Handle JSON response
            if isinstance(element, dict):
                return {
                    "title": element.get("text", ""),
                    "location": element.get("categories", {}).get("location", ""),
                    "department": element.get("categories", {}).get("team", ""),
                    "url": element.get("hostedUrl", ""),
                    "posted_date": element.get("createdAt", ""),
                    "source_platform": "lever",
                    "raw_data": element,
                }

            # Handle HTML element
            title = self.extract_text(element, ".posting-title h5, .posting-title")
            location = self.extract_text(element, ".posting-categories .location")
            department = self.extract_text(
                element, ".posting-categories .department, .posting-categories .team"
            )
            url = self.extract_attribute(element, "a", "href")

            if url and not url.startswith("http"):
                url = urljoin(self.company_url, url)

            return {
                "title": title,
                "location": location,
                "department": department,
                "url": url,
                "source_platform": "lever",
                "raw_data": {"html": str(element)},
            }
        except Exception as e:
            logger.error(f"Failed to parse Lever job listing: {e}")
            return {}


class WorkdayScraper(BaseScraper):
    """Scraper for Workday-powered career pages."""

    def __init__(self, company_url: str, config: Optional[ScraperConfig] = None):
        """
        Initialize Workday scraper.

        Args:
            company_url: Base URL of the company's Workday career page
            config: Scraper configuration
        """
        super().__init__(config)
        self.company_url = company_url.rstrip("/")
        self.platform = "workday"

    def scrape_jobs(self, **kwargs) -> List[Dict[str, Any]]:
        """
        Scrape jobs from Workday career page.

        Note: Workday often uses dynamic loading, so this may need adjustment

        Args:
            **kwargs: Query parameters

        Returns:
            List of job dictionaries
        """
        query_builder = QueryBuilder(platform=self.platform)

        for key, value in kwargs.items():
            if hasattr(QueryParam, key.upper()):
                param = getattr(QueryParam, key.upper())
                query_builder.custom_param(param, value)

        url = query_builder.build_url(self.company_url)

        soup = self.fetch_page(url)
        if not soup:
            return []

        jobs = []
        # Workday structures vary, common selectors:
        job_elements = soup.select(
            '[data-automation-id="compositeContainer"] li, .jobResultItem'
        )

        for element in job_elements:
            job = self.parse_job_listing(element)
            if job:
                jobs.append(self.normalize_job_data(job))

        logger.info(f"Scraped {len(jobs)} jobs from Workday")
        return jobs

    def parse_job_listing(self, element: BeautifulSoup) -> Dict[str, Any]:
        """Parse a Workday job listing element."""
        try:
            title = self.extract_text(
                element, '[data-automation-id="jobTitle"], .jobTitle, h3'
            )
            location = self.extract_text(
                element, '[data-automation-id="locations"], .jobLocation'
            )
            url = self.extract_attribute(element, "a", "href")

            if url and not url.startswith("http"):
                url = urljoin(self.company_url, url)

            return {
                "title": title,
                "location": location,
                "url": url,
                "source_platform": "workday",
                "raw_data": {"html": str(element)},
            }
        except Exception as e:
            logger.error(f"Failed to parse Workday job listing: {e}")
            return {}


class GenericCareerScraper(BaseScraper):
    """
    Generic career page scraper for custom or unknown platforms.

    This scraper attempts to find job listings using common patterns
    and can be configured with custom selectors.
    """

    def __init__(
        self,
        url: str,
        job_container_selector: str = None,
        title_selector: str = "h3, h2, .title, .job-title",
        location_selector: str = ".location, .job-location",
        url_selector: str = "a",
        config: Optional[ScraperConfig] = None,
    ):
        """
        Initialize generic scraper.

        Args:
            url: Base URL of career page
            job_container_selector: CSS selector for job listing containers
            title_selector: CSS selector for job title
            location_selector: CSS selector for location
            url_selector: CSS selector for job URL link
            config: Scraper configuration
        """
        super().__init__(config)
        self.url = url
        self.job_container_selector = job_container_selector
        self.title_selector = title_selector
        self.location_selector = location_selector
        self.url_selector = url_selector
        self.platform = "generic"

    def scrape_jobs(self, **kwargs) -> List[Dict[str, Any]]:
        """Scrape jobs using generic patterns."""
        query_builder = QueryBuilder(platform=self.platform)

        for key, value in kwargs.items():
            if hasattr(QueryParam, key.upper()):
                param = getattr(QueryParam, key.upper())
                query_builder.custom_param(param, value)

        url = query_builder.build_url(self.url)

        soup = self.fetch_page(url)
        if not soup:
            return []

        # Auto-detect job containers if not specified
        if not self.job_container_selector:
            job_elements = self._auto_detect_jobs(soup)
        else:
            job_elements = soup.select(self.job_container_selector)

        jobs = []
        for element in job_elements:
            job = self.parse_job_listing(element)
            if job:
                jobs.append(self.normalize_job_data(job))

        logger.info(f"Scraped {len(jobs)} jobs from generic page")
        return jobs

    def _auto_detect_jobs(self, soup: BeautifulSoup) -> List:
        """Attempt to auto-detect job listing containers."""
        # Common patterns for job listings
        patterns = [
            ".job, .job-listing, .position, .opening, .posting",
            '[class*="job"], [class*="position"], [class*="career"]',
            "article, .card",
        ]

        for pattern in patterns:
            elements = soup.select(pattern)
            if elements:
                logger.info(f"Auto-detected jobs with pattern: {pattern}")
                return elements

        return []

    def parse_job_listing(self, element: BeautifulSoup) -> Dict[str, Any]:
        """Parse a generic job listing element."""
        try:
            title = self.extract_text(element, self.title_selector)
            location = self.extract_text(element, self.location_selector)
            url = self.extract_attribute(element, self.url_selector, "href")

            if url and not url.startswith("http"):
                url = urljoin(self.url, url)

            return {
                "title": title,
                "location": location,
                "url": url,
                "source_platform": "generic",
                "raw_data": {"html": str(element)},
            }
        except Exception as e:
            logger.error(f"Failed to parse generic job listing: {e}")
            return {}
