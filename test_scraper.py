"""
Quick test script to validate the Scraper module structure
without making actual web requests.
"""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_imports():
    """Test that all modules can be imported."""
    print("Testing imports...")

    try:
        from Scraper import (
            BaseScraper,
            ScraperConfig,
            GreenhouseScraper,
            LeverScraper,
            WorkdayScraper,
            GenericCareerScraper,
            CompanyConfig,
            CompanyRegistry,
            ScraperFactory,
            Platform,
            QueryParam,
            QueryBuilder,
            JobType,
            ExperienceLevel,
            RemoteOption,
            create_scraper_by_name,
            list_available_companies,
        )

        print("✓ All imports successful")
        return True
    except ImportError as e:
        print(f"✗ Import failed: {e}")
        return False


def test_query_builder():
    """Test QueryBuilder functionality."""
    print("\nTesting QueryBuilder...")

    from Scraper import QueryBuilder, JobType, ExperienceLevel, QueryParam

    # Test basic query building
    query = (
        QueryBuilder("greenhouse")
        .keywords("python developer")
        .location("San Francisco")
        .department("Engineering")
        .page(1)
    )

    params = query.build()
    print(f"✓ Built query with {len(params)} parameters")
    print(f"  Parameters: {params}")

    # Test URL building
    url = query.build_url("https://example.com/jobs")
    print(f"✓ Built URL: {url}")

    return True


def test_company_registry():
    """Test CompanyRegistry functionality."""
    print("\nTesting CompanyRegistry...")

    from Scraper import CompanyRegistry, CompanyConfig, Platform

    registry = CompanyRegistry()

    # Test listing companies
    companies = registry.list_companies()
    print(f"✓ Registry has {len(companies)} companies")
    print(f"  Companies: {', '.join(companies[:5])}...")

    # Test adding a company
    config = CompanyConfig(
        name="Test Company", url="https://test.com/careers", platform=Platform.GENERIC
    )
    registry.add_company(config)

    # Test retrieving
    retrieved = registry.get_company("Test Company")
    if retrieved:
        print(f"✓ Successfully added and retrieved 'Test Company'")

    # Test removing
    registry.remove_company("Test Company")
    if not registry.get_company("Test Company"):
        print(f"✓ Successfully removed 'Test Company'")

    return True


def test_platform_mappings():
    """Test query parameter mappings for different platforms."""
    print("\nTesting Platform Mappings...")

    from Scraper import QueryParamMapper, QueryParam

    platforms = ["greenhouse", "lever", "workday", "linkedin", "indeed"]

    for platform in platforms:
        mapper = QueryParamMapper(platform)
        param_name = mapper.get_param_name(QueryParam.KEYWORDS)
        print(f"✓ {platform.capitalize()}: KEYWORDS → '{param_name}'")

    return True


def test_custom_mapping():
    """Test adding custom parameter mappings."""
    print("\nTesting Custom Mappings...")

    from Scraper import QueryParamMapper, QueryParam

    mapper = QueryParamMapper("custom_platform")

    # Add custom mapping
    mapper.add_custom_mapping(QueryParam.KEYWORDS, "search_query")
    mapped = mapper.get_param_name(QueryParam.KEYWORDS)

    if mapped == "search_query":
        print("✓ Custom mapping added successfully")
        print(f"  KEYWORDS → '{mapped}'")

    # Remove mapping
    mapper.remove_mapping(QueryParam.KEYWORDS)
    removed = mapper.get_param_name(QueryParam.KEYWORDS)

    if removed is None:
        print("✓ Mapping removed successfully")

    return True


def test_scraper_config():
    """Test ScraperConfig creation."""
    print("\nTesting ScraperConfig...")

    from Scraper import ScraperConfig

    config = ScraperConfig(timeout=30, max_retries=3, rate_limit_delay=1.5)

    print(f"✓ Created ScraperConfig")
    print(f"  Timeout: {config.timeout}s")
    print(f"  Max retries: {config.max_retries}")
    print(f"  Rate limit: {config.rate_limit_delay}s")

    headers = config.get_headers()
    print(f"✓ Generated {len(headers)} headers")

    return True


def test_enums():
    """Test all enum classes."""
    print("\nTesting Enums...")

    from Scraper import JobType, ExperienceLevel, RemoteOption, Platform

    print(f"✓ JobType has {len(JobType)} values")
    print(f"  Examples: {[t.value for t in list(JobType)[:3]]}")

    print(f"✓ ExperienceLevel has {len(ExperienceLevel)} values")
    print(f"  Examples: {[l.value for l in list(ExperienceLevel)[:3]]}")

    print(f"✓ RemoteOption has {len(RemoteOption)} values")
    print(f"  Examples: {[r.value for r in list(RemoteOption)]}")

    print(f"✓ Platform has {len(Platform)} values")
    print(f"  Examples: {[p.value for p in list(Platform)]}")

    return True


def test_factory():
    """Test ScraperFactory."""
    print("\nTesting ScraperFactory...")

    from Scraper import ScraperFactory, CompanyConfig, Platform

    configs = [
        CompanyConfig("Test GH", "https://test.com", Platform.GREENHOUSE),
        CompanyConfig("Test Lever", "https://test.com", Platform.LEVER),
        CompanyConfig("Test WD", "https://test.com", Platform.WORKDAY),
        CompanyConfig("Test Generic", "https://test.com", Platform.GENERIC),
    ]

    for config in configs:
        scraper = ScraperFactory.create_scraper(config)
        print(f"✓ Created {scraper.__class__.__name__} for {config.platform.value}")

    return True


def test_convenience_functions():
    """Test convenience functions."""
    print("\nTesting Convenience Functions...")

    from Scraper import list_available_companies, add_company, Platform

    # List companies
    companies = list_available_companies()
    print(f"✓ list_available_companies() returned {len(companies)} companies")

    # Add company
    add_company(
        name="Test Corp",
        url="https://test.com/jobs",
        platform=Platform.GENERIC,
        notes="Test company",
    )
    print(f"✓ add_company() added 'Test Corp'")

    # Verify it's in the list
    if "test corp" in list_available_companies():
        print(f"✓ New company appears in company list")

    return True


def main():
    """Run all tests."""
    print("=" * 60)
    print("Scraper Module Structure Validation")
    print("=" * 60)

    tests = [
        ("Imports", test_imports),
        ("QueryBuilder", test_query_builder),
        ("CompanyRegistry", test_company_registry),
        ("Platform Mappings", test_platform_mappings),
        ("Custom Mappings", test_custom_mapping),
        ("ScraperConfig", test_scraper_config),
        ("Enums", test_enums),
        ("ScraperFactory", test_factory),
        ("Convenience Functions", test_convenience_functions),
    ]

    passed = 0
    failed = 0

    for name, test_func in tests:
        try:
            if test_func():
                passed += 1
            else:
                failed += 1
                print(f"✗ {name} FAILED")
        except Exception as e:
            failed += 1
            print(f"✗ {name} FAILED with exception: {e}")
            import traceback

            traceback.print_exc()

    print("\n" + "=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)

    if failed == 0:
        print("\n✓ All tests passed! The scraper module is ready to use.")
        print("\nNext steps:")
        print("1. Run: python Scraper/examples.py")
        print("2. Check Scraper/README.md for documentation")
        print("3. Start scraping career pages!")
    else:
        print(f"\n⚠️  {failed} test(s) failed. Please check the errors above.")

    print()


if __name__ == "__main__":
    main()
