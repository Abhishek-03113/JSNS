"""
Example usage of the Career Page Scraper module.

This demonstrates how to use the scraper with different companies
and platforms, add custom query parameters, and extend functionality.
"""

import sys
import os
import json

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from Scraper import (
    create_scraper_by_name,
    list_available_companies,
    add_company,
    QueryBuilder,
    JobType,
    ExperienceLevel,
    RemoteOption,
    QueryParam,
    Platform,
    CompanyRegistry,
    GenericCareerScraper,
    ScraperConfig,
    get_global_registry,
)


def example_1_basic_scraping():
    """Example 1: Basic scraping of a company's career page."""
    print("\n" + "=" * 60)
    print("Example 1: Basic Scraping")
    print("=" * 60)

    # List available companies
    print("\nAvailable companies:")
    companies = list_available_companies()
    for company in companies:
        print(f"  - {company.title()}")

    # Create a scraper for Netflix (uses Greenhouse)
    print("\nScraping Netflix jobs...")
    scraper = create_scraper_by_name("Netflix")

    # Scrape all jobs
    jobs = scraper.scrape_jobs()

    print(f"\nFound {len(jobs)} jobs")
    if jobs:
        print("\nFirst job:")
        print(json.dumps(jobs[0], indent=2))


def example_2_filtered_search():
    """Example 2: Scraping with filters."""
    print("\n" + "=" * 60)
    print("Example 2: Filtered Search")
    print("=" * 60)

    # Create scraper
    scraper = create_scraper_by_name("Airbnb")

    # Scrape with filters
    print("\nSearching for Engineering jobs in San Francisco...")
    jobs = scraper.scrape_jobs(department="Engineering", location="San Francisco")

    print(f"\nFound {len(jobs)} matching jobs")
    for job in jobs[:3]:  # Show first 3
        print(f"\n  Title: {job['title']}")
        print(f"  Location: {job['location']}")
        print(f"  URL: {job['url']}")


def example_3_query_builder():
    """Example 3: Using QueryBuilder for advanced queries."""
    print("\n" + "=" * 60)
    print("Example 3: Using QueryBuilder")
    print("=" * 60)

    # Build a complex query
    query = (
        QueryBuilder("lever")
        .keywords("software engineer")
        .location("Remote")
        .job_type(JobType.FULL_TIME)
        .experience_level(ExperienceLevel.SENIOR)
        .page(1)
        .limit(20)
    )

    print("\nBuilt query parameters:")
    print(json.dumps(query.build(), indent=2))

    # Use with scraper
    scraper = create_scraper_by_name("Stripe")
    jobs = scraper.scrape_jobs(**query.build())

    print(f"\nFound {len(jobs)} jobs matching criteria")


def example_4_add_custom_company():
    """Example 4: Adding a custom company to the registry."""
    print("\n" + "=" * 60)
    print("Example 4: Adding Custom Company")
    print("=" * 60)

    # Add a new company
    print("\nAdding Tesla to the registry...")
    add_company(
        name="Tesla",
        url="https://www.tesla.com/careers/search",
        platform=Platform.GENERIC,
        notes="Tesla uses a custom career platform",
    )

    # Verify it was added
    companies = list_available_companies()
    if "tesla" in companies:
        print("✓ Tesla successfully added!")

    # Create scraper for the new company
    scraper = create_scraper_by_name("Tesla")
    print(f"✓ Created scraper for Tesla")
    print(f"  URL: {scraper.url}")


def example_5_custom_selectors():
    """Example 5: Using GenericCareerScraper with custom selectors."""
    print("\n" + "=" * 60)
    print("Example 5: Custom Selectors for Generic Scraper")
    print("=" * 60)

    # Create a generic scraper with custom selectors
    scraper = GenericCareerScraper(
        url="https://example-company.com/careers",
        job_container_selector=".job-card",
        title_selector=".job-title h2",
        location_selector=".job-location span",
        url_selector="a.job-link",
    )

    print("\nCreated generic scraper with custom selectors:")
    print(f"  Job container: {scraper.job_container_selector}")
    print(f"  Title selector: {scraper.title_selector}")
    print(f"  Location selector: {scraper.location_selector}")

    # Note: This would actually scrape if the URL existed
    # jobs = scraper.scrape_jobs()


def example_6_scraper_config():
    """Example 6: Customizing scraper behavior with ScraperConfig."""
    print("\n" + "=" * 60)
    print("Example 6: Custom Scraper Configuration")
    print("=" * 60)

    # Create custom configuration
    config = ScraperConfig(
        timeout=60,  # Longer timeout
        max_retries=5,  # More retries
        retry_delay=3,  # Longer delay between retries
        rate_limit_delay=2.0,  # 2 seconds between requests
        user_agent="Custom Bot 1.0",
    )

    print("\nCreated custom scraper configuration:")
    print(f"  Timeout: {config.timeout}s")
    print(f"  Max retries: {config.max_retries}")
    print(f"  Rate limit: {config.rate_limit_delay}s")

    # Use with a scraper
    scraper = create_scraper_by_name("Shopify", scraper_config=config)
    print(f"✓ Created scraper with custom config")


def example_7_save_and_load_registry():
    """Example 7: Saving and loading company registry."""
    print("\n" + "=" * 60)
    print("Example 7: Save/Load Registry")
    print("=" * 60)

    registry = get_global_registry()

    # Add a custom company
    add_company(
        name="SpaceX",
        url="https://www.spacex.com/careers",
        platform=Platform.GENERIC,
        notes="SpaceX careers page",
    )

    # Save to file
    filepath = "company_registry.json"
    registry.save_to_file(filepath)
    print(f"\n✓ Saved registry to {filepath}")

    # Load from file
    new_registry = CompanyRegistry()
    new_registry.load_from_file(filepath)
    print(f"✓ Loaded registry from {filepath}")
    print(f"  Companies loaded: {len(new_registry.list_companies())}")

    # Clean up
    if os.path.exists(filepath):
        os.remove(filepath)
        print(f"✓ Cleaned up {filepath}")


def example_8_search_and_filter():
    """Example 8: Searching for companies and filtering by platform."""
    print("\n" + "=" * 60)
    print("Example 8: Search and Filter Companies")
    print("=" * 60)

    registry = get_global_registry()

    # Search for companies
    print("\nSearching for companies with 'shop' in name:")
    results = registry.search_companies("shop")
    for company in results:
        print(f"  - {company.name} ({company.platform.value})")

    # Get companies by platform
    print("\nCompanies using Greenhouse:")
    greenhouse_companies = registry.get_companies_by_platform(Platform.GREENHOUSE)
    for company in greenhouse_companies:
        print(f"  - {company.name}")


def example_9_extending_query_params():
    """Example 9: Adding custom query parameter mappings."""
    print("\n" + "=" * 60)
    print("Example 9: Extending Query Parameters")
    print("=" * 60)

    # Create a query builder
    builder = QueryBuilder("custom_platform")

    # Add custom parameter mapping
    builder.mapper.add_custom_mapping(QueryParam.KEYWORDS, "search_term")
    builder.mapper.add_custom_mapping(QueryParam.LOCATION, "geo_location")

    # Build query with custom mappings
    query = builder.keywords("python developer").location("Boston").build()

    print("\nCustom query parameters:")
    print(json.dumps(query, indent=2))
    print("\n✓ Custom mappings applied successfully")


def example_10_context_manager():
    """Example 10: Using scraper as context manager."""
    print("\n" + "=" * 60)
    print("Example 10: Context Manager Usage")
    print("=" * 60)

    # Use scraper with context manager for automatic cleanup
    print("\nUsing scraper with context manager...")

    with create_scraper_by_name("Netflix") as scraper:
        jobs = scraper.scrape_jobs(limit="10")
        print(f"✓ Scraped {len(jobs)} jobs")
        print("✓ Session will be automatically closed")

    print("✓ Context manager exited, resources cleaned up")


def main():
    """Run all examples."""
    print("\n" + "=" * 60)
    print("Career Page Scraper - Example Usage")
    print("=" * 60)

    examples = [
        ("Basic Scraping", example_1_basic_scraping),
        ("Filtered Search", example_2_filtered_search),
        ("Query Builder", example_3_query_builder),
        ("Add Custom Company", example_4_add_custom_company),
        ("Custom Selectors", example_5_custom_selectors),
        ("Scraper Configuration", example_6_scraper_config),
        ("Save/Load Registry", example_7_save_and_load_registry),
        ("Search and Filter", example_8_search_and_filter),
        ("Extending Query Params", example_9_extending_query_params),
        ("Context Manager", example_10_context_manager),
    ]

    print("\nAvailable examples:")
    for i, (name, _) in enumerate(examples, 1):
        print(f"  {i}. {name}")

    print("\n" + "=" * 60)
    choice = input(
        "\nEnter example number to run (or 'all' for all examples): "
    ).strip()

    if choice.lower() == "all":
        for name, func in examples:
            try:
                func()
            except Exception as e:
                print(f"\n⚠️  Example failed: {e}")
    elif choice.isdigit() and 1 <= int(choice) <= len(examples):
        try:
            examples[int(choice) - 1][1]()
        except Exception as e:
            print(f"\n⚠️  Example failed: {e}")
    else:
        print("Invalid choice!")

    print("\n" + "=" * 60)
    print("Examples completed!")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
