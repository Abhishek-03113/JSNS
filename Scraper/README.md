# Career Page Scraper

A modular, extensible, and production-ready scraper for extracting job listings from career pages across different platforms.

## 🚀 Features

- **Modular Design**: Separate concerns with base classes, platform-specific scrapers, and configuration
- **Enum-Style Query Parameters**: Type-safe query building with extensible parameter mappings
- **Multi-Platform Support**: Built-in support for Greenhouse, Lever, Workday, and generic career pages
- **Extensible Architecture**: Easy to add new platforms, companies, and query parameters
- **Company Registry**: Pre-configured companies with ability to add/remove dynamically
- **Retry Logic**: Automatic retries with exponential backoff
- **Rate Limiting**: Configurable delays between requests to respect server limits
- **Context Manager Support**: Automatic resource cleanup
- **JSON Export**: Easy serialization of scraped data

## 📁 Structure

```
Scraper/
├── __init__.py              # Package initialization and exports
├── base_scraper.py          # Abstract base scraper with common functionality
├── career_scraper.py        # Platform-specific scraper implementations
├── config.py                # Company registry and configuration management
├── query_params.py          # Enum-based query parameter system
├── examples.py              # Comprehensive usage examples
└── README.md                # This file
```

## 📦 Installation

```bash
# Install required dependencies
pip install requests beautifulsoup4 urllib3
```

## 🎯 Quick Start

### Basic Usage

```python
from Scraper import create_scraper_by_name

# Create a scraper for a company
scraper = create_scraper_by_name("Netflix")

# Scrape all jobs
jobs = scraper.scrape_jobs()

# Print results
for job in jobs:
    print(f"{job['title']} - {job['location']}")
```

### Filtered Search

```python
# Scrape with filters
jobs = scraper.scrape_jobs(
    department="Engineering",
    location="San Francisco",
    keywords="python"
)
```

### Using QueryBuilder

```python
from Scraper import QueryBuilder, JobType, ExperienceLevel

# Build a complex query
query = (QueryBuilder("lever")
         .keywords("machine learning")
         .location("Remote")
         .job_type(JobType.FULL_TIME)
         .experience_level(ExperienceLevel.SENIOR)
         .build())

jobs = scraper.scrape_jobs(**query)
```

## 🔧 Query Parameters

### Standard Query Parameters (Enum)

All query parameters are defined as enums in `QueryParam`:

```python
from Scraper import QueryParam

# Common parameters
QueryParam.KEYWORDS      # Search keywords
QueryParam.LOCATION      # Job location
QueryParam.DEPARTMENT    # Department/team
QueryParam.JOB_TYPE      # Full-time, part-time, etc.
QueryParam.LEVEL         # Experience level
QueryParam.REMOTE        # Remote work option
QueryParam.PAGE          # Page number
QueryParam.LIMIT         # Results per page
```

### Adding Custom Parameters

```python
from Scraper import QueryBuilder, QueryParam

builder = QueryBuilder("custom_platform")

# Add custom mapping
builder.mapper.add_custom_mapping(
    QueryParam.KEYWORDS, 
    "search_query"  # Platform-specific parameter name
)

# Remove a mapping
builder.mapper.remove_mapping(QueryParam.LOCATION)
```

### Platform-Specific Mappings

The system automatically maps standard parameters to platform-specific names:

| Standard | Greenhouse | Lever | Workday | LinkedIn |
|----------|-----------|-------|---------|----------|
| KEYWORDS | `q` | `query` | `q` | `keywords` |
| LOCATION | `location` | `location` | `locationCountry` | `location` |
| DEPARTMENT | `department` | `team` | `jobFamilyGroup` | - |

## 🏢 Company Registry

### List Available Companies

```python
from Scraper import list_available_companies

companies = list_available_companies()
print(companies)
# ['airbnb', 'google', 'netflix', 'shopify', 'stripe']
```

### Add a New Company

```python
from Scraper import add_company, Platform

add_company(
    name="Tesla",
    url="https://www.tesla.com/careers/search",
    platform=Platform.GENERIC,
    notes="Custom career platform"
)
```

### Add with Custom Selectors

```python
add_company(
    name="Custom Corp",
    url="https://custom.com/jobs",
    platform=Platform.GENERIC,
    custom_selectors={
        "job_container": ".job-listing",
        "title": ".job-title h2",
        "location": ".location-text",
        "url": "a.apply-link"
    }
)
```

### Remove a Company

```python
from Scraper import get_global_registry

registry = get_global_registry()
registry.remove_company("Tesla")
```

### Save/Load Registry

```python
registry = get_global_registry()

# Save to JSON file
registry.save_to_file("companies.json")

# Load from JSON file
registry.load_from_file("companies.json")
```

## 🎨 Supported Platforms

### 1. Greenhouse

```python
from Scraper import GreenhouseScraper

scraper = GreenhouseScraper("https://boards.greenhouse.io/company")
jobs = scraper.scrape_jobs(department="Engineering")
```

### 2. Lever

```python
from Scraper import LeverScraper

scraper = LeverScraper("https://jobs.lever.co/company")
jobs = scraper.scrape_jobs(team="Product")
```

### 3. Workday

```python
from Scraper import WorkdayScraper

scraper = WorkdayScraper("https://company.wd1.myworkdayjobs.com/Careers")
jobs = scraper.scrape_jobs(location="New York")
```

### 4. Generic (Custom Platforms)

```python
from Scraper import GenericCareerScraper

scraper = GenericCareerScraper(
    url="https://example.com/careers",
    job_container_selector=".job-card",
    title_selector="h3.title",
    location_selector=".location"
)
jobs = scraper.scrape_jobs()
```

## ⚙️ Configuration

### Scraper Configuration

```python
from Scraper import ScraperConfig, create_scraper_by_name

config = ScraperConfig(
    timeout=60,                    # Request timeout (seconds)
    max_retries=5,                 # Maximum retry attempts
    retry_delay=3,                 # Delay between retries
    rate_limit_delay=2.0,          # Delay between requests
    user_agent="CustomBot/1.0",    # Custom user agent
    verify_ssl=True                # SSL verification
)

scraper = create_scraper_by_name("Netflix", scraper_config=config)
```

### Custom Headers

```python
config = ScraperConfig(
    headers={
        "Authorization": "Bearer token",
        "X-Custom-Header": "value"
    }
)
```

## 🔄 Extending the System

### Adding a New Platform

1. **Create a new scraper class:**

```python
from Scraper import BaseScraper
import logging

logger = logging.getLogger(__name__)

class CustomPlatformScraper(BaseScraper):
    def __init__(self, url, config=None):
        super().__init__(config)
        self.url = url
        self.platform = "custom"
    
    def scrape_jobs(self, **kwargs):
        soup = self.fetch_page(self.url)
        jobs = []
        
        for element in soup.select('.job'):
            job = self.parse_job_listing(element)
            if job:
                jobs.append(self.normalize_job_data(job))
        
        return jobs
    
    def parse_job_listing(self, element):
        return {
            "title": self.extract_text(element, '.title'),
            "location": self.extract_text(element, '.location'),
            "url": self.extract_attribute(element, 'a', 'href'),
            "source_platform": self.platform
        }
```

2. **Add to Platform enum:**

```python
# In config.py
class Platform(Enum):
    GREENHOUSE = "greenhouse"
    LEVER = "lever"
    WORKDAY = "workday"
    GENERIC = "generic"
    CUSTOM = "custom"  # Add new platform
```

3. **Update ScraperFactory:**

```python
# In config.py, ScraperFactory.create_scraper()
elif config.platform == Platform.CUSTOM:
    return CustomPlatformScraper(config.url, scraper_config)
```

### Adding New Query Parameters

```python
# In query_params.py
class QueryParam(Enum):
    # Add new parameters
    SALARY_RANGE = "salary_range"
    BENEFITS = "benefits"
    WORK_AUTHORIZATION = "work_auth"
```

### Adding Platform Mappings

```python
from Scraper import QueryParam

mapper = QueryParamMapper("new_platform")

# Add mappings for the new platform
mapper.add_platform("new_platform", {
    QueryParam.KEYWORDS: "search",
    QueryParam.LOCATION: "city",
    QueryParam.DEPARTMENT: "div"
})
```

## 📊 Data Format

Scraped jobs return normalized dictionaries:

```python
{
    "title": "Senior Software Engineer",
    "company": "Tech Corp",
    "location": "San Francisco, CA",
    "job_type": "Full-time",
    "experience_level": "Senior",
    "department": "Engineering",
    "description": "Job description...",
    "url": "https://...",
    "posted_date": "2024-01-15",
    "salary": "$150k-$200k",
    "remote": True,
    "skills": ["Python", "AWS", "Docker"],
    "source_platform": "greenhouse",
    "raw_data": {...}
}
```

## 🛡️ Best Practices

### 1. Use Context Managers

```python
with create_scraper_by_name("Netflix") as scraper:
    jobs = scraper.scrape_jobs()
    # Session automatically closed
```

### 2. Configure Rate Limiting

```python
config = ScraperConfig(rate_limit_delay=2.0)  # 2 seconds between requests
scraper = create_scraper_by_name("Company", scraper_config=config)
```

### 3. Handle Errors Gracefully

```python
try:
    jobs = scraper.scrape_jobs()
except Exception as e:
    logger.error(f"Scraping failed: {e}")
    jobs = []
```

### 4. Save Results

```python
import json

jobs = scraper.scrape_jobs()

with open('jobs.json', 'w') as f:
    json.dump(jobs, f, indent=2)
```

## 🧪 Running Examples

```bash
cd Scraper
python examples.py
```

Choose from 10 comprehensive examples:
1. Basic Scraping
2. Filtered Search
3. Query Builder
4. Add Custom Company
5. Custom Selectors
6. Scraper Configuration
7. Save/Load Registry
8. Search and Filter
9. Extending Query Params
10. Context Manager

## 🔍 Debugging

Enable detailed logging:

```python
import logging

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
```

## 📝 API Reference

### Core Classes

- **`BaseScraper`**: Abstract base class for all scrapers
- **`GreenhouseScraper`**: Greenhouse platform scraper
- **`LeverScraper`**: Lever platform scraper
- **`WorkdayScraper`**: Workday platform scraper
- **`GenericCareerScraper`**: Generic scraper with custom selectors

### Configuration

- **`ScraperConfig`**: Configure scraper behavior
- **`CompanyConfig`**: Company-specific configuration
- **`CompanyRegistry`**: Manage company configurations
- **`Platform`**: Platform enum

### Query Building

- **`QueryParam`**: Standard query parameters
- **`QueryBuilder`**: Fluent query builder
- **`JobType`**: Job type enum
- **`ExperienceLevel`**: Experience level enum
- **`RemoteOption`**: Remote work options

## 🤝 Contributing

To add a new platform or company:

1. Create a scraper class extending `BaseScraper`
2. Implement `scrape_jobs()` and `parse_job_listing()`
3. Add platform to `Platform` enum
4. Update `ScraperFactory`
5. Add default companies to `CompanyRegistry`

## 📄 License

MIT

## 🆘 Support

For issues or questions, please check the examples or create an issue in the repository.
