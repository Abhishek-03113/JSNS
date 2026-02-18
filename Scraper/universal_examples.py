"""
Universal Career Scraper - Examples

This demonstrates how to scrape ANY career page without knowing
the platform or structure in advance.
"""

import sys
import os
import json

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from Scraper import (
    scrape_jobs,
    analyze_career_page,
    quick_scrape,
    UniversalCareerScraper,
    QueryBuilder,
)


def example_1_simplest_usage():
    """Example 1: Simplest possible usage."""
    print("\n" + "=" * 70)
    print("Example 1: Simplest Usage - Just Give It a URL!")
    print("=" * 70)

    # That's it! The scraper figures out everything automatically
    print("\nScraping jobs from any company...")
    print("(Using a sample URL - replace with real career page)")

    # Examples of URLs that would work:
    urls = [
        "https://www.netflix.com/jobs",
        "https://stripe.com/jobs/search",
        "https://www.airbnb.com/careers/departments",
        "https://www.shopify.com/careers",
        "https://about.google/careers/applications/jobs/results/",
    ]

    print("\nThis scraper can handle ANY of these URLs (and more):")
    for url in urls:
        print(f"  ✓ {url}")

    # Simulated output
    print("\nUsage:")
    print("  jobs = scrape_jobs('https://company.com/careers')")
    print("\nThe scraper will automatically:")
    print("  1. Detect the page structure")
    print("  2. Find job listing containers")
    print("  3. Extract titles, locations, URLs, etc.")
    print("  4. Return normalized data")


def example_2_with_filters():
    """Example 2: Scraping with filters."""
    print("\n" + "=" * 70)
    print("Example 2: Scraping with Filters")
    print("=" * 70)

    print("\nScrape with keyword and location filters:")
    print(
        """
    jobs = scrape_jobs(
        "https://company.com/careers",
        keywords="software engineer",
        location="San Francisco",
        max_jobs=50
    )
    """
    )

    print("\nThe scraper will:")
    print("  1. Auto-detect the page structure")
    print("  2. Apply filters if the platform supports them")
    print("  3. Extract and normalize job data")
    print("  4. Return up to 50 matching jobs")


def example_3_analyze_first():
    """Example 3: Analyze page structure before scraping."""
    print("\n" + "=" * 70)
    print("Example 3: Analyze Page Structure")
    print("=" * 70)

    print("\nFirst, analyze what patterns the scraper detects:")
    print(
        """
    analysis = analyze_career_page("https://company.com/careers")
    
    print(f"Container selector: {analysis['container_selector']}")
    print(f"Estimated jobs: {analysis['estimated_job_count']}")
    print(f"Field selectors: {analysis['field_selectors']}")
    print(f"Sample jobs: {analysis['sample_jobs']}")
    """
    )

    print("\nExample output:")
    print(
        json.dumps(
            {
                "container_selector": ".job-listing",
                "container_confidence": 0.85,
                "field_selectors": {
                    "title": "h3.job-title",
                    "location": ".location-text",
                    "url": "a.apply-link",
                },
                "estimated_job_count": 47,
                "sample_jobs": [
                    {
                        "title": "Senior Software Engineer",
                        "location": "San Francisco, CA",
                        "url": "https://company.com/jobs/123",
                    }
                ],
            },
            indent=2,
        )
    )


def example_4_advanced_usage():
    """Example 4: Advanced usage with UniversalCareerScraper."""
    print("\n" + "=" * 70)
    print("Example 4: Advanced Usage")
    print("=" * 70)

    print("\nFor more control, use UniversalCareerScraper directly:")
    print(
        """
    scraper = UniversalCareerScraper("https://company.com/careers")
    
    # First, analyze the page
    analysis = scraper.analyze_page()
    print(f"Detected {analysis['estimated_job_count']} jobs")
    print(f"Pattern confidence: {analysis['container_confidence']:.2f}")
    
    # Then scrape multiple pages
    jobs = scraper.scrape_jobs(max_pages=5)
    
    # Export patterns for reuse
    scraper.export_patterns("company_patterns.json")
    
    # Later, reuse patterns (faster)
    new_scraper = UniversalCareerScraper("https://company.com/careers")
    new_scraper.import_patterns("company_patterns.json")
    jobs = new_scraper.scrape_jobs()
    """
    )


def example_5_multiple_companies():
    """Example 5: Scraping multiple companies."""
    print("\n" + "=" * 70)
    print("Example 5: Scraping Multiple Companies")
    print("=" * 70)

    print("\nScrape from multiple companies in one script:")
    print(
        """
    companies = {
        "Netflix": "https://jobs.netflix.com",
        "Stripe": "https://stripe.com/jobs/search",
        "Airbnb": "https://careers.airbnb.com",
        "Shopify": "https://www.shopify.com/careers/search"
    }
    
    all_jobs = []
    
    for company, url in companies.items():
        print(f"\\nScraping {company}...")
        jobs = scrape_jobs(url, max_jobs=25)
        
        # Add company name to each job
        for job in jobs:
            job['company'] = company
        
        all_jobs.extend(jobs)
        print(f"  Found {len(jobs)} jobs")
    
    print(f"\\nTotal jobs found: {len(all_jobs)}")
    
    # Save to file
    with open('all_jobs.json', 'w') as f:
        json.dump(all_jobs, f, indent=2)
    """
    )


def example_6_quick_scrape():
    """Example 6: Quick scrape for rapid testing."""
    print("\n" + "=" * 70)
    print("Example 6: Quick Scrape")
    print("=" * 70)

    print("\nFor testing or quick checks:")
    print(
        """
    # Get first 20 jobs quickly
    jobs = quick_scrape("https://company.com/careers", limit=20)
    
    for job in jobs[:5]:
        print(f"{job['title']} - {job['location']}")
    """
    )


def example_7_error_handling():
    """Example 7: Error handling and troubleshooting."""
    print("\n" + "=" * 70)
    print("Example 7: Error Handling")
    print("=" * 70)

    print("\nRobust scraping with error handling:")
    print(
        """
    try:
        # Analyze first to check if detection works
        analysis = analyze_career_page("https://company.com/careers")
        
        if analysis['container_confidence'] < 0.5:
            print("⚠️  Low confidence in pattern detection")
            print("Recommendations:", analysis['recommendations'])
        
        # Proceed with scraping
        jobs = scrape_jobs("https://company.com/careers", max_jobs=100)
        
        if not jobs:
            print("No jobs found - page structure may be unusual")
        else:
            print(f"Successfully scraped {len(jobs)} jobs")
            
    except Exception as e:
        print(f"Scraping failed: {e}")
        # Fall back to manual configuration if needed
    """
    )


def example_8_custom_configuration():
    """Example 8: Custom scraper configuration."""
    print("\n" + "=" * 70)
    print("Example 8: Custom Configuration")
    print("=" * 70)

    print("\nCustomize scraper behavior:")
    print(
        """
    from Scraper import ScraperConfig, UniversalCareerScraper
    
    # Create custom configuration
    config = ScraperConfig(
        timeout=60,              # Longer timeout for slow sites
        max_retries=5,           # More retry attempts
        rate_limit_delay=2.0,    # 2 seconds between requests
        user_agent="MyBot/1.0"   # Custom user agent
    )
    
    # Use with universal scraper
    scraper = UniversalCareerScraper(
        "https://company.com/careers",
        config=config,
        min_confidence=0.7       # Higher confidence threshold
    )
    
    jobs = scraper.scrape_jobs(max_pages=3)
    """
    )


def example_9_data_processing():
    """Example 9: Processing and filtering scraped data."""
    print("\n" + "=" * 70)
    print("Example 9: Data Processing")
    print("=" * 70)

    print("\nFilter and process scraped jobs:")
    print(
        """
    # Scrape all jobs
    all_jobs = scrape_jobs("https://company.com/careers", max_jobs=200)
    
    # Filter for remote positions
    remote_jobs = [
        job for job in all_jobs 
        if job.get('remote') == True or 'remote' in job.get('location', '').lower()
    ]
    
    # Filter by keyword in title
    engineering_jobs = [
        job for job in all_jobs
        if 'engineer' in job.get('title', '').lower()
    ]
    
    # Group by location
    from collections import defaultdict
    by_location = defaultdict(list)
    for job in all_jobs:
        location = job.get('location', 'Unknown')
        by_location[location].append(job)
    
    # Print statistics
    print(f"Total jobs: {len(all_jobs)}")
    print(f"Remote jobs: {len(remote_jobs)}")
    print(f"Engineering jobs: {len(engineering_jobs)}")
    print(f"Locations: {len(by_location)}")
    """
    )


def example_10_integration():
    """Example 10: Integration with other tools."""
    print("\n" + "=" * 70)
    print("Example 10: Integration Examples")
    print("=" * 70)

    print("\nIntegrate with databases, spreadsheets, or other tools:")
    print(
        """
    # 1. Export to CSV
    import csv
    
    jobs = scrape_jobs("https://company.com/careers", max_jobs=100)
    
    with open('jobs.csv', 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['title', 'location', 'url', 'department'])
        writer.writeheader()
        writer.writerows(jobs)
    
    # 2. Save to JSON
    with open('jobs.json', 'w') as f:
        json.dump(jobs, f, indent=2)
    
    # 3. Send to database (example with SQLite)
    import sqlite3
    
    conn = sqlite3.connect('jobs.db')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS jobs (
            title TEXT,
            location TEXT,
            url TEXT UNIQUE,
            department TEXT
        )
    ''')
    
    for job in jobs:
        cursor.execute(
            'INSERT OR IGNORE INTO jobs VALUES (?, ?, ?, ?)',
            (job.get('title'), job.get('location'), job.get('url'), job.get('department'))
        )
    
    conn.commit()
    conn.close()
    
    # 4. Send notifications (example)
    for job in jobs[:5]:  # First 5 jobs
        if 'senior' in job['title'].lower():
            print(f"📧 New senior role: {job['title']}")
    """
    )


def main():
    """Run all examples."""
    print("\n" + "=" * 70)
    print("UNIVERSAL CAREER SCRAPER - Examples")
    print("Works on ANY Career Page!")
    print("=" * 70)

    print("\n✨ Key Features:")
    print("  • Automatic pattern detection")
    print("  • No platform-specific knowledge required")
    print("  • Works on Greenhouse, Lever, Workday, and custom platforms")
    print("  • Intelligent field extraction")
    print("  • Handles pagination automatically")

    examples = [
        ("Simplest Usage", example_1_simplest_usage),
        ("With Filters", example_2_with_filters),
        ("Analyze Structure", example_3_analyze_first),
        ("Advanced Usage", example_4_advanced_usage),
        ("Multiple Companies", example_5_multiple_companies),
        ("Quick Scrape", example_6_quick_scrape),
        ("Error Handling", example_7_error_handling),
        ("Custom Configuration", example_8_custom_configuration),
        ("Data Processing", example_9_data_processing),
        ("Integration", example_10_integration),
    ]

    print("\n" + "=" * 70)
    print("Available Examples:")
    print("=" * 70)
    for i, (name, _) in enumerate(examples, 1):
        print(f"  {i}. {name}")

    print("\n" + "=" * 70)
    choice = input("\nEnter example number (or 'all' to see all): ").strip()

    if choice.lower() == "all":
        for _name, func in examples:
            func()
    elif choice.isdigit() and 1 <= int(choice) <= len(examples):
        examples[int(choice) - 1][1]()
    else:
        print("Invalid choice. Showing all examples...")
        for name, func in examples:
            func()

    print("\n" + "=" * 70)
    print("Universal Scraper Examples Complete!")
    print("=" * 70)
    print("\n📚 Key Takeaway:")
    print("   Just use: scrape_jobs('https://company.com/careers')")
    print("   The scraper handles the rest automatically!")
    print("\n" + "=" * 70 + "\n")


if __name__ == "__main__":
    main()
