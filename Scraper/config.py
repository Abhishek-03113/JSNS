"""
Configuration Module for Career Page Scrapers.

This module provides configuration management for different companies
and their career page platforms. It makes it easy to add, remove, or
update company configurations.
"""

from typing import Dict, List, Optional
from enum import Enum
import json
import os


class Platform(Enum):
    """Supported career page platforms."""

    GREENHOUSE = "greenhouse"
    LEVER = "lever"
    WORKDAY = "workday"
    GENERIC = "generic"


class CompanyConfig:
    """Configuration for a company's career page."""

    def __init__(
        self,
        name: str,
        url: str,
        platform: Platform,
        custom_selectors: Optional[Dict[str, str]] = None,
        notes: str = "",
    ):
        """
        Initialize company configuration.

        Args:
            name: Company name
            url: Base URL of career page
            platform: Platform enum value
            custom_selectors: Custom CSS selectors (for generic platform)
            notes: Additional notes about the configuration
        """
        self.name = name
        self.url = url
        self.platform = platform
        self.custom_selectors = custom_selectors or {}
        self.notes = notes

    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "url": self.url,
            "platform": self.platform.value,
            "custom_selectors": self.custom_selectors,
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "CompanyConfig":
        """Create from dictionary."""
        return cls(
            name=data["name"],
            url=data["url"],
            platform=Platform(data["platform"]),
            custom_selectors=data.get("custom_selectors", {}),
            notes=data.get("notes", ""),
        )


class CompanyRegistry:
    """
    Registry for managing company career page configurations.

    This makes it easy to add, remove, update, and retrieve company
    configurations dynamically.
    """

    def __init__(self):
        """Initialize the company registry."""
        self.companies: Dict[str, CompanyConfig] = {}
        self._load_default_companies()

    def _load_default_companies(self):
        """Load default company configurations."""
        default_companies = [
            CompanyConfig(
                name="Google",
                url="https://careers.google.com/jobs/results/",
                platform=Platform.GENERIC,
                notes="Google uses a custom platform",
            ),
            CompanyConfig(
                name="Netflix",
                url="https://jobs.netflix.com/search",
                platform=Platform.GREENHOUSE,
                notes="Netflix uses Greenhouse",
            ),
            CompanyConfig(
                name="Airbnb",
                url="https://careers.airbnb.com/positions/",
                platform=Platform.GREENHOUSE,
                notes="Airbnb uses Greenhouse",
            ),
            CompanyConfig(
                name="Stripe",
                url="https://stripe.com/jobs/search",
                platform=Platform.LEVER,
                notes="Stripe uses Lever",
            ),
            CompanyConfig(
                name="Shopify",
                url="https://www.shopify.com/careers/search",
                platform=Platform.LEVER,
                notes="Shopify uses Lever",
            ),
            # Add more companies as needed
        ]

        for company in default_companies:
            self.add_company(company)

    def add_company(self, config: CompanyConfig):
        """
        Add a company configuration to the registry.

        Args:
            config: CompanyConfig instance
        """
        self.companies[config.name.lower()] = config

    def remove_company(self, company_name: str):
        """
        Remove a company from the registry.

        Args:
            company_name: Name of the company to remove
        """
        company_key = company_name.lower()
        if company_key in self.companies:
            del self.companies[company_key]

    def get_company(self, company_name: str) -> Optional[CompanyConfig]:
        """
        Get a company configuration by name.

        Args:
            company_name: Name of the company

        Returns:
            CompanyConfig instance or None if not found
        """
        return self.companies.get(company_name.lower())

    def update_company(self, company_name: str, **kwargs):
        """
        Update a company's configuration.

        Args:
            company_name: Name of the company to update
            **kwargs: Fields to update (url, platform, custom_selectors, notes)
        """
        company = self.get_company(company_name)
        if company:
            if "url" in kwargs:
                company.url = kwargs["url"]
            if "platform" in kwargs:
                company.platform = kwargs["platform"]
            if "custom_selectors" in kwargs:
                company.custom_selectors = kwargs["custom_selectors"]
            if "notes" in kwargs:
                company.notes = kwargs["notes"]

    def list_companies(self) -> List[str]:
        """Get list of all registered company names."""
        return sorted(self.companies.keys())

    def get_companies_by_platform(self, platform: Platform) -> List[CompanyConfig]:
        """
        Get all companies using a specific platform.

        Args:
            platform: Platform enum value

        Returns:
            List of CompanyConfig instances
        """
        return [
            config for config in self.companies.values() if config.platform == platform
        ]

    def save_to_file(self, filepath: str):
        """
        Save registry to a JSON file.

        Args:
            filepath: Path to save the configuration file
        """
        data = {"companies": [config.to_dict() for config in self.companies.values()]}

        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)

    def load_from_file(self, filepath: str):
        """
        Load registry from a JSON file.

        Args:
            filepath: Path to the configuration file
        """
        if not os.path.exists(filepath):
            return

        with open(filepath, "r") as f:
            data = json.load(f)

        self.companies.clear()
        for company_data in data.get("companies", []):
            config = CompanyConfig.from_dict(company_data)
            self.add_company(config)

    def search_companies(self, keyword: str) -> List[CompanyConfig]:
        """
        Search for companies by keyword.

        Args:
            keyword: Search keyword

        Returns:
            List of matching CompanyConfig instances
        """
        keyword_lower = keyword.lower()
        matches = []

        for config in self.companies.values():
            if (
                keyword_lower in config.name.lower()
                or keyword_lower in config.url.lower()
                or keyword_lower in config.notes.lower()
            ):
                matches.append(config)

        return matches


class ScraperFactory:
    """
    Factory class for creating scrapers based on platform type.

    This provides a clean interface for instantiating the correct
    scraper type for a given company or platform.
    """

    @staticmethod
    def create_scraper(config: CompanyConfig, scraper_config=None):
        """
        Create a scraper instance based on company configuration.

        Args:
            config: CompanyConfig instance
            scraper_config: Optional ScraperConfig for customizing behavior

        Returns:
            Scraper instance (GreenhouseScraper, LeverScraper, etc.)
        """
        from career_scraper import (
            GreenhouseScraper,
            LeverScraper,
            WorkdayScraper,
            GenericCareerScraper,
        )

        if config.platform == Platform.GREENHOUSE:
            return GreenhouseScraper(config.url, scraper_config)

        elif config.platform == Platform.LEVER:
            return LeverScraper(config.url, scraper_config)

        elif config.platform == Platform.WORKDAY:
            return WorkdayScraper(config.url, scraper_config)

        elif config.platform == Platform.GENERIC:
            return GenericCareerScraper(
                url=config.url,
                job_container_selector=config.custom_selectors.get("job_container"),
                title_selector=config.custom_selectors.get("title", "h3, h2"),
                location_selector=config.custom_selectors.get("location", ".location"),
                url_selector=config.custom_selectors.get("url", "a"),
                config=scraper_config,
            )

        else:
            raise ValueError(f"Unsupported platform: {config.platform}")

    @staticmethod
    def create_scraper_by_name(
        company_name: str, registry: CompanyRegistry = None, scraper_config=None
    ):
        """
        Create a scraper by company name.

        Args:
            company_name: Name of the company
            registry: CompanyRegistry instance (creates new one if None)
            scraper_config: Optional ScraperConfig

        Returns:
            Scraper instance
        """
        if registry is None:
            registry = CompanyRegistry()

        config = registry.get_company(company_name)
        if not config:
            raise ValueError(f"Company '{company_name}' not found in registry")

        return ScraperFactory.create_scraper(config, scraper_config)


# Global registry instance
_global_registry = None


def get_global_registry() -> CompanyRegistry:
    """Get or create the global company registry."""
    global _global_registry
    if _global_registry is None:
        _global_registry = CompanyRegistry()
    return _global_registry
