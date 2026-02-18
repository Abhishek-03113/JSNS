"""
Base Scraper Module for Career Pages.

This module provides the base scraper class that can be extended
for specific career platforms.
"""

import requests
import logging
import time
from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ScraperConfig:
    """Configuration for scraper behavior."""

    def __init__(
        self,
        timeout: int = 30,
        max_retries: int = 3,
        retry_delay: int = 2,
        user_agent: str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        headers: Optional[Dict[str, str]] = None,
        verify_ssl: bool = True,
        rate_limit_delay: float = 1.0,
    ):
        """
        Initialize scraper configuration.

        Args:
            timeout: Request timeout in seconds
            max_retries: Maximum number of retry attempts
            retry_delay: Delay between retries in seconds
            user_agent: User agent string for requests
            headers: Additional headers to include
            verify_ssl: Whether to verify SSL certificates
            rate_limit_delay: Delay between requests in seconds
        """
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.user_agent = user_agent
        self.headers = headers or {}
        self.verify_ssl = verify_ssl
        self.rate_limit_delay = rate_limit_delay

    def get_headers(self) -> Dict[str, str]:
        """Get headers for HTTP requests."""
        default_headers = {
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
        }
        default_headers.update(self.headers)
        return default_headers


class BaseScraper(ABC):
    """
    Abstract base class for career page scrapers.

    This class provides common functionality for scraping career pages
    and should be extended for specific platforms.
    """

    def __init__(self, config: Optional[ScraperConfig] = None):
        """
        Initialize the base scraper.

        Args:
            config: Scraper configuration object
        """
        self.config = config or ScraperConfig()
        self.session = requests.Session()
        self.session.headers.update(self.config.get_headers())
        self.last_request_time = 0

    def _rate_limit(self):
        """Apply rate limiting between requests."""
        current_time = time.time()
        time_since_last = current_time - self.last_request_time

        if time_since_last < self.config.rate_limit_delay:
            time.sleep(self.config.rate_limit_delay - time_since_last)

        self.last_request_time = time.time()

    def _make_request(
        self, url: str, method: str = "GET", **kwargs
    ) -> Optional[requests.Response]:
        """
        Make an HTTP request with retry logic.

        Args:
            url: URL to request
            method: HTTP method (GET or POST)
            **kwargs: Additional arguments for requests

        Returns:
            Response object or None if failed
        """
        self._rate_limit()

        for attempt in range(self.config.max_retries):
            try:
                logger.info(
                    f"Requesting {url} (attempt {attempt + 1}/{self.config.max_retries})"
                )

                if method.upper() == "GET":
                    response = self.session.get(
                        url,
                        timeout=self.config.timeout,
                        verify=self.config.verify_ssl,
                        **kwargs,
                    )
                elif method.upper() == "POST":
                    response = self.session.post(
                        url,
                        timeout=self.config.timeout,
                        verify=self.config.verify_ssl,
                        **kwargs,
                    )
                else:
                    raise ValueError(f"Unsupported HTTP method: {method}")

                response.raise_for_status()
                return response

            except requests.exceptions.RequestException as e:
                logger.warning(f"Request failed: {e}")

                if attempt < self.config.max_retries - 1:
                    time.sleep(self.config.retry_delay * (attempt + 1))
                else:
                    logger.error(
                        f"Failed to fetch {url} after {self.config.max_retries} attempts"
                    )

        return None

    def fetch_page(self, url: str) -> Optional[BeautifulSoup]:
        """
        Fetch a page and return parsed HTML.

        Args:
            url: URL to fetch

        Returns:
            BeautifulSoup object or None if failed
        """
        response = self._make_request(url)

        if response:
            return BeautifulSoup(response.content, "html.parser")

        return None

    def fetch_json(self, url: str, method: str = "GET", **kwargs) -> Optional[Dict]:
        """
        Fetch JSON data from an API endpoint.

        Args:
            url: URL to fetch
            method: HTTP method
            **kwargs: Additional arguments for requests

        Returns:
            Parsed JSON as dictionary or None if failed
        """
        response = self._make_request(url, method, **kwargs)

        if response:
            try:
                return response.json()
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON from {url}: {e}")

        return None

    @abstractmethod
    def scrape_jobs(self, **kwargs) -> List[Dict[str, Any]]:
        """
        Scrape job listings from the career page.

        This method should be implemented by subclasses for specific platforms.

        Args:
            **kwargs: Platform-specific parameters

        Returns:
            List of job dictionaries
        """
        pass

    @abstractmethod
    def parse_job_listing(self, element: Any) -> Dict[str, Any]:
        """
        Parse a single job listing element.

        This method should be implemented by subclasses.

        Args:
            element: HTML element or JSON object representing a job

        Returns:
            Dictionary with standardized job information
        """
        pass

    def extract_text(self, element, selector: str, default: str = "") -> str:
        """
        Safely extract text from an element.

        Args:
            element: BeautifulSoup element
            selector: CSS selector
            default: Default value if not found

        Returns:
            Extracted text or default
        """
        try:
            found = element.select_one(selector)
            return found.get_text(strip=True) if found else default
        except Exception as e:
            logger.warning(f"Failed to extract text with selector '{selector}': {e}")
            return default

    def extract_attribute(
        self, element, selector: str, attribute: str, default: str = ""
    ) -> str:
        """
        Safely extract an attribute from an element.

        Args:
            element: BeautifulSoup element
            selector: CSS selector
            attribute: Attribute name to extract
            default: Default value if not found

        Returns:
            Extracted attribute value or default
        """
        try:
            found = element.select_one(selector)
            return found.get(attribute, default) if found else default
        except Exception as e:
            logger.warning(
                f"Failed to extract attribute '{attribute}' with selector '{selector}': {e}"
            )
            return default

    def normalize_job_data(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize job data to a standard format.

        Args:
            raw_data: Raw job data from platform

        Returns:
            Normalized job dictionary
        """
        return {
            "title": raw_data.get("title", ""),
            "company": raw_data.get("company", ""),
            "location": raw_data.get("location", ""),
            "job_type": raw_data.get("job_type", ""),
            "experience_level": raw_data.get("experience_level", ""),
            "department": raw_data.get("department", ""),
            "description": raw_data.get("description", ""),
            "url": raw_data.get("url", ""),
            "posted_date": raw_data.get("posted_date", ""),
            "salary": raw_data.get("salary", ""),
            "remote": raw_data.get("remote", False),
            "skills": raw_data.get("skills", []),
            "source_platform": raw_data.get("source_platform", ""),
            "raw_data": raw_data.get("raw_data", {}),
        }

    def close(self):
        """Close the scraper session."""
        self.session.close()

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()
