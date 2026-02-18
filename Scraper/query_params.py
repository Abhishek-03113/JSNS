"""
Query Parameters Enum Module for Career Page Scrapers.

This module defines extensible query parameters that are commonly used
across different career pages. You can easily add or remove parameters
by modifying the enums.
"""

from enum import Enum
from typing import Dict, List, Optional, Any


class QueryParam(Enum):
    """Base enum for common query parameters used in career pages."""

    # Search and filtering
    KEYWORDS = "keywords"
    QUERY = "q"
    SEARCH = "search"
    TERM = "term"

    # Location parameters
    LOCATION = "location"
    CITY = "city"
    STATE = "state"
    COUNTRY = "country"
    ZIP_CODE = "zip"
    REMOTE = "remote"

    # Job type and level
    JOB_TYPE = "job_type"
    EMPLOYMENT_TYPE = "employment_type"
    FULL_TIME = "full_time"
    PART_TIME = "part_time"
    CONTRACT = "contract"
    INTERNSHIP = "internship"

    # Experience level
    LEVEL = "level"
    EXPERIENCE = "experience"
    SENIORITY = "seniority"

    # Department and category
    DEPARTMENT = "department"
    CATEGORY = "category"
    TEAM = "team"
    DIVISION = "division"

    # Pagination
    PAGE = "page"
    OFFSET = "offset"
    LIMIT = "limit"
    PER_PAGE = "per_page"
    START = "start"

    # Sorting
    SORT = "sort"
    ORDER = "order"
    SORT_BY = "sort_by"
    ORDER_BY = "order_by"

    # Date filters
    POSTED_DATE = "posted_date"
    DATE_POSTED = "date_posted"
    DAYS_AGO = "days_ago"

    # Additional filters
    SKILLS = "skills"
    INDUSTRY = "industry"
    COMPANY_SIZE = "company_size"
    SALARY_MIN = "salary_min"
    SALARY_MAX = "salary_max"


class JobType(Enum):
    """Job type values."""

    FULL_TIME = "Full-time"
    PART_TIME = "Part-time"
    CONTRACT = "Contract"
    TEMPORARY = "Temporary"
    INTERNSHIP = "Internship"
    VOLUNTEER = "Volunteer"


class ExperienceLevel(Enum):
    """Experience level values."""

    ENTRY_LEVEL = "Entry Level"
    JUNIOR = "Junior"
    MID_LEVEL = "Mid Level"
    SENIOR = "Senior"
    LEAD = "Lead"
    MANAGER = "Manager"
    DIRECTOR = "Director"
    EXECUTIVE = "Executive"


class RemoteOption(Enum):
    """Remote work options."""

    ON_SITE = "On-site"
    REMOTE = "Remote"
    HYBRID = "Hybrid"


class SortOrder(Enum):
    """Sort order options."""

    ASCENDING = "asc"
    DESCENDING = "desc"
    RELEVANCE = "relevance"
    DATE_POSTED = "date"


class QueryParamMapper:
    """
    Maps standardized query parameters to platform-specific parameter names.
    This makes it easy to adapt the scraper to different career platforms.
    """

    def __init__(self, platform_name: str = "generic"):
        """
        Initialize the query parameter mapper for a specific platform.

        Args:
            platform_name: Name of the career platform (e.g., 'greenhouse', 'lever', 'workday')
        """
        self.platform_name = platform_name
        self.mappings = self._load_platform_mappings()

    def _load_platform_mappings(self) -> Dict[str, Dict[QueryParam, str]]:
        """
        Load platform-specific query parameter mappings.

        Returns:
            Dictionary mapping platforms to their parameter name mappings
        """
        return {
            "greenhouse": {
                QueryParam.KEYWORDS: "q",
                QueryParam.LOCATION: "location",
                QueryParam.DEPARTMENT: "department",
                QueryParam.PAGE: "page",
            },
            "lever": {
                QueryParam.KEYWORDS: "query",
                QueryParam.LOCATION: "location",
                QueryParam.TEAM: "team",
                QueryParam.LEVEL: "commitment",
            },
            "workday": {
                QueryParam.KEYWORDS: "q",
                QueryParam.LOCATION: "locationCountry",
                QueryParam.JOB_TYPE: "workerSubType",
                QueryParam.CATEGORY: "jobFamilyGroup",
            },
            "linkedin": {
                QueryParam.KEYWORDS: "keywords",
                QueryParam.LOCATION: "location",
                QueryParam.JOB_TYPE: "f_JT",
                QueryParam.EXPERIENCE: "f_E",
                QueryParam.REMOTE: "f_WT",
            },
            "indeed": {
                QueryParam.QUERY: "q",
                QueryParam.LOCATION: "l",
                QueryParam.JOB_TYPE: "jt",
                QueryParam.POSTED_DATE: "fromage",
                QueryParam.START: "start",
            },
            "generic": {
                QueryParam.KEYWORDS: "q",
                QueryParam.LOCATION: "location",
                QueryParam.DEPARTMENT: "department",
                QueryParam.PAGE: "page",
                QueryParam.JOB_TYPE: "type",
            },
        }

    def get_param_name(self, param: QueryParam) -> Optional[str]:
        """
        Get the platform-specific parameter name for a standard parameter.

        Args:
            param: Standard QueryParam enum value

        Returns:
            Platform-specific parameter name or None if not mapped
        """
        platform_map = self.mappings.get(self.platform_name, {})
        return platform_map.get(param)

    def map_params(self, standard_params: Dict[QueryParam, Any]) -> Dict[str, Any]:
        """
        Map standardized parameters to platform-specific parameter names.

        Args:
            standard_params: Dictionary with QueryParam keys

        Returns:
            Dictionary with platform-specific parameter names
        """
        mapped = {}
        platform_map = self.mappings.get(self.platform_name, {})

        for param, value in standard_params.items():
            platform_param = platform_map.get(param)
            if platform_param:
                mapped[platform_param] = value

        return mapped

    def add_custom_mapping(self, param: QueryParam, platform_param_name: str):
        """
        Add or update a custom parameter mapping for the current platform.

        Args:
            param: Standard QueryParam enum value
            platform_param_name: Platform-specific parameter name
        """
        if self.platform_name not in self.mappings:
            self.mappings[self.platform_name] = {}

        self.mappings[self.platform_name][param] = platform_param_name

    def remove_mapping(self, param: QueryParam):
        """
        Remove a parameter mapping for the current platform.

        Args:
            param: Standard QueryParam enum value to remove
        """
        if self.platform_name in self.mappings:
            self.mappings[self.platform_name].pop(param, None)

    def add_platform(self, platform_name: str, mappings: Dict[QueryParam, str]):
        """
        Add a new platform with its parameter mappings.

        Args:
            platform_name: Name of the new platform
            mappings: Dictionary mapping QueryParam to platform-specific names
        """
        self.mappings[platform_name] = mappings

    def get_all_platforms(self) -> List[str]:
        """Get list of all supported platforms."""
        return list(self.mappings.keys())


class QueryBuilder:
    """
    Builder class for constructing career page queries in a fluent way.
    """

    def __init__(self, platform: str = "generic"):
        """
        Initialize the query builder.

        Args:
            platform: Career platform name
        """
        self.mapper = QueryParamMapper(platform)
        self.params: Dict[QueryParam, Any] = {}

    def keywords(self, keywords: str) -> "QueryBuilder":
        """Add keywords/search query."""
        self.params[QueryParam.KEYWORDS] = keywords
        return self

    def location(self, location: str) -> "QueryBuilder":
        """Add location filter."""
        self.params[QueryParam.LOCATION] = location
        return self

    def department(self, department: str) -> "QueryBuilder":
        """Add department filter."""
        self.params[QueryParam.DEPARTMENT] = department
        return self

    def job_type(self, job_type: JobType) -> "QueryBuilder":
        """Add job type filter."""
        self.params[QueryParam.JOB_TYPE] = job_type.value
        return self

    def experience_level(self, level: ExperienceLevel) -> "QueryBuilder":
        """Add experience level filter."""
        self.params[QueryParam.LEVEL] = level.value
        return self

    def remote(self, remote: RemoteOption) -> "QueryBuilder":
        """Add remote work filter."""
        self.params[QueryParam.REMOTE] = remote.value
        return self

    def page(self, page: int) -> "QueryBuilder":
        """Add page number for pagination."""
        self.params[QueryParam.PAGE] = page
        return self

    def limit(self, limit: int) -> "QueryBuilder":
        """Add limit for results per page."""
        self.params[QueryParam.LIMIT] = limit
        return self

    def sort(self, order: SortOrder) -> "QueryBuilder":
        """Add sort order."""
        self.params[QueryParam.SORT] = order.value
        return self

    def custom_param(self, param: QueryParam, value: Any) -> "QueryBuilder":
        """Add a custom parameter."""
        self.params[param] = value
        return self

    def build(self) -> Dict[str, Any]:
        """
        Build and return the platform-specific query parameters.

        Returns:
            Dictionary of query parameters ready for URL construction
        """
        return self.mapper.map_params(self.params)

    def build_url(self, base_url: str) -> str:
        """
        Build a complete URL with query parameters.

        Args:
            base_url: Base URL of the career page

        Returns:
            Complete URL with query string
        """
        from urllib.parse import urlencode

        query_params = self.build()
        if not query_params:
            return base_url

        query_string = urlencode(query_params)
        separator = "&" if "?" in base_url else "?"
        return f"{base_url}{separator}{query_string}"
