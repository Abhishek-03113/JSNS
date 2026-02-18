"""
Universal Career Page Scraper.

Intelligently scrapes ANY career page without platform-specific knowledge.
Uses pattern detection and adaptive strategies to extract job listings.

Simple Usage:
    from Scraper import scrape_jobs

    # Scrape any career page - it figures out the structure automatically
    jobs = scrape_jobs("https://company.com/careers")

    # With filters
    jobs = scrape_jobs("https://company.com/careers",
                       keywords="engineer",
                       location="Remote")

Advanced Usage:
    from Scraper import UniversalCareerScraper

    scraper = UniversalCareerScraper("https://company.com/careers")

    # Analyze page structure first
    analysis = scraper.analyze_page()
    print(analysis)

    # Then scrape
    jobs = scraper.scrape_jobs(max_pages=3)
"""

from .base_scraper import BaseScraper, ScraperConfig
from .universal_scraper import UniversalCareerScraper, SmartCareerScraper
from .pattern_detector import JobPatternDetector

# Keep legacy imports for backward compatibility
from .career_scraper import (
    GreenhouseScraper,
    LeverScraper,
    WorkdayScraper,
    GenericCareerScraper,
)
from .config import (
    CompanyConfig,
    CompanyRegistry,
    ScraperFactory,
    Platform,
    get_global_registry,
)
from .query_params import (
    QueryParam,
    QueryBuilder,
    QueryParamMapper,
    JobType,
    ExperienceLevel,
    RemoteOption,
    SortOrder,
)


# ============= MAIN API FUNCTIONS =============


def scrape_jobs(url: str, max_jobs: int = 100, **filters):
    """
    Scrape jobs from ANY career page URL - automatic pattern detection.

    This is the simplest way to scrape jobs. Just provide a URL and
    the scraper will automatically figure out the page structure.

    Args:
        url: Career page URL (e.g., "https://company.com/careers")
        max_jobs: Maximum number of jobs to return (default: 100)
        **filters: Optional filters (keywords, location, department, etc.)

    Returns:
        List of job dictionaries

    Example:
        # Basic usage
        jobs = scrape_jobs("https://netflix.com/jobs")

        # With filters
        jobs = scrape_jobs("https://stripe.com/jobs",
                          keywords="engineer",
                          location="Remote",
                          max_jobs=50)
    """
    return SmartCareerScraper.scrape(url, max_jobs=max_jobs, **filters)


def analyze_career_page(url: str):
    """
    Analyze a career page structure and return detected patterns.

    Useful for understanding what the scraper detected and debugging.

    Args:
        url: Career page URL

    Returns:
        Dictionary with analysis results including:
        - container_selector: CSS selector for job containers
        - field_selectors: Selectors for title, location, etc.
        - estimated_job_count: Number of jobs detected
        - sample_jobs: Sample extracted data

    Example:
        analysis = analyze_career_page("https://company.com/careers")
        print(f"Found {analysis['estimated_job_count']} jobs")
        print(f"Container: {analysis['container_selector']}")
    """
    scraper = UniversalCareerScraper(url)
    return scraper.analyze_page()


def quick_scrape(url: str, limit: int = 50):
    """
    Quick scrape with minimal configuration.

    Args:
        url: Career page URL
        limit: Maximum number of jobs (default: 50)

    Returns:
        List of job dictionaries

    Example:
        jobs = quick_scrape("https://google.com/careers")
    """
    return SmartCareerScraper.quick_scrape(url, limit=limit)


# Legacy convenience functions (for backward compatibility)
def create_scraper_by_name(company_name: str, scraper_config=None):
    """
    Create a scraper for a company by name (legacy platform-specific).

    NOTE: For new code, use scrape_jobs() or UniversalCareerScraper directly.

    Args:
        company_name: Name of the company
        scraper_config: Optional ScraperConfig

    Returns:
        Scraper instance
    """
    return ScraperFactory.create_scraper_by_name(
        company_name, get_global_registry(), scraper_config
    )


def list_available_companies():
    """Get list of all available companies in the registry (legacy)."""
    return get_global_registry().list_companies()


def add_company(name: str, url: str, platform: Platform, **kwargs):
    """
    Add a new company to the global registry (legacy).

    NOTE: For new code, just use scrape_jobs() with the URL directly.

    Args:
        name: Company name
        url: Career page URL
        platform: Platform enum value
        **kwargs: Additional configuration (custom_selectors, notes)
    """
    config = CompanyConfig(name, url, platform, **kwargs)
    get_global_registry().add_company(config)


__all__ = [
    # ===== PRIMARY API (Use These!) =====
    "scrape_jobs",  # Main function - scrape any career page
    "analyze_career_page",  # Analyze page structure
    "quick_scrape",  # Quick scrape with defaults
    "UniversalCareerScraper",  # Advanced universal scraper
    "SmartCareerScraper",  # High-level smart scraper
    # ===== Pattern Detection =====
    "JobPatternDetector",  # Pattern detection engine
    # ===== Base Classes =====
    "BaseScraper",
    "ScraperConfig",
    # ===== Query Building =====
    "QueryParam",
    "QueryBuilder",
    "QueryParamMapper",
    "JobType",
    "ExperienceLevel",
    "RemoteOption",
    "SortOrder",
    # ===== Legacy Platform-Specific (Backward Compatibility) =====
    "GreenhouseScraper",
    "LeverScraper",
    "WorkdayScraper",
    "GenericCareerScraper",
    "CompanyConfig",
    "CompanyRegistry",
    "ScraperFactory",
    "Platform",
    "get_global_registry",
    "create_scraper_by_name",  # Legacy
    "list_available_companies",  # Legacy
    "add_company",  # Legacy
]

__version__ = "2.0.0"  # Major version bump for universal scraper
