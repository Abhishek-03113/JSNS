# Universal Career Page Scraper 🚀

**Intelligently scrape ANY career page without knowing the platform or structure in advance.**

No more platform-specific scrapers. No more manual configuration. Just give it a URL and it figures everything out automatically using intelligent pattern detection.

## ✨ Key Features

- 🎯 **Works on ANY Career Page**: Automatically detects patterns on Greenhouse, Lever, Workday, and custom platforms
- 🧠 **Intelligent Pattern Detection**: Uses heuristics and structural analysis to find job listings
- 🔧 **Zero Configuration**: Just provide a URL - no selectors, no platform knowledge required
- 📦 **Normalized Data**: Returns consistent data format regardless of source platform
- ⚡ **Fast & Reliable**: Built-in retry logic, rate limiting, and error handling
- 🔄 **Adaptive**: Learns and caches patterns for faster subsequent scrapes

## 🎉 Simplest Possible Usage

```python
from Scraper import scrape_jobs

# That's it! Works on any career page
jobs = scrape_jobs("https://company.com/careers")

for job in jobs:
    print(f"{job['title']} - {job['location']}")
```

## 📦 Installation

```bash
pip install requests beautifulsoup4
```

## 🚀 Quick Start

### Basic Scraping

```python
from Scraper import scrape_jobs

# Scrape any company's career page
jobs = scrape_jobs("https://netflix.com/jobs")
jobs = scrape_jobs("https://stripe.com/careers")
jobs = scrape_jobs("https://airbnb.com/careers")
# ... works on ANY career page!
```

### With Filters

```python
# Apply filters
jobs = scrape_jobs(
    "https://company.com/careers",
    keywords="software engineer",
    location="Remote",
    max_jobs=50
)
```

### Quick Scrape

```python
from Scraper import quick_scrape

# Get first 20 jobs quickly
jobs = quick_scrape("https://company.com/careers", limit=20)
```

## 🔍 How It Works

```
┌─────────────────────────────────────────┐
│  1. Fetch Career Page                   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  2. Pattern Detection Engine            │
│     • Find repeating elements           │
│     • Score job container candidates    │
│     • Detect field selectors            │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  3. Extract Job Data                    │
│     • Title, Location, URL              │
│     • Department, Job Type, etc.        │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  4. Normalize & Return                  │
│     • Consistent format                 │
│     • Cleaned data                      │
└─────────────────────────────────────────┘
```

The scraper:
1. Analyzes the HTML structure
2. Identifies repeating patterns that likely represent jobs
3. Detects which elements contain titles, locations, etc.
4. Extracts and normalizes the data

No platform-specific knowledge required!

## 🎨 Advanced Usage

### Analyze Page Structure

```python
from Scraper import analyze_career_page

# See what patterns the scraper detected
analysis = analyze_career_page("https://company.com/careers")

print(f"Container selector: {analysis['container_selector']}")
print(f"Confidence: {analysis['container_confidence']:.2f}")
print(f"Estimated jobs: {analysis['estimated_job_count']}")
print(f"Field selectors: {analysis['field_selectors']}")
```

### Advanced Control

```python
from Scraper import UniversalCareerScraper

scraper = UniversalCareerScraper("https://company.com/careers")

# Analyze first
analysis = scraper.analyze_page()
print(json.dumps(analysis, indent=2))

# Then scrape multiple pages
jobs = scraper.scrape_jobs(max_pages=5)

# Export detected patterns for reuse
scraper.export_patterns("company_patterns.json")

# Later, import patterns (faster)
new_scraper = UniversalCareerScraper("https://company.com/careers")
new_scraper.import_patterns("company_patterns.json")
jobs = new_scraper.scrape_jobs()
```

### Custom Configuration

```python
from Scraper import UniversalCareerScraper, ScraperConfig

config = ScraperConfig(
    timeout=60,              # Request timeout
    max_retries=5,           # Retry attempts
    rate_limit_delay=2.0,    # Delay between requests
    min_confidence=0.7       # Higher confidence threshold
)

scraper = UniversalCareerScraper("https://company.com/careers", config=config)
jobs = scraper.scrape_jobs()
```

## 📊 Data Format

All jobs are returned in a normalized format:

```python
{
    "title": "Senior Software Engineer",
    "company": "Tech Corp",
    "location": "San Francisco, CA",
    "department": "Engineering",
    "job_type": "Full-time",
    "remote": True,
    "url": "https://company.com/jobs/123",
    "posted_date": "2024-01-15",
    "source_platform": "universal",
    "raw_data": {...}
}
```

## 🌍 Scrape Multiple Companies

```python
from Scraper import scrape_jobs

companies = {
    "Netflix": "https://jobs.netflix.com",
    "Stripe": "https://stripe.com/jobs/search",
    "Airbnb": "https://careers.airbnb.com",
    "Shopify": "https://www.shopify.com/careers/search"
}

all_jobs = []

for company, url in companies.items():
    print(f"Scraping {company}...")
    jobs = scrape_jobs(url, max_jobs=25)
    
    for job in jobs:
        job['company'] = company
    
    all_jobs.extend(jobs)

print(f"Total: {len(all_jobs)} jobs")
```

## 💾 Export Data

```python
import json
import csv

jobs = scrape_jobs("https://company.com/careers", max_jobs=100)

# Export to JSON
with open('jobs.json', 'w') as f:
    json.dump(jobs, f, indent=2)

# Export to CSV
with open('jobs.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['title', 'location', 'url'])
    writer.writeheader()
    writer.writerows(jobs)
```

## 🎯 Real-World Examples

### Example 1: Job Alert System

```python
from Scraper import scrape_jobs

# Find senior remote positions
jobs = scrape_jobs(
    "https://company.com/careers",
    keywords="senior",
    max_jobs=100
)

senior_remote = [
    job for job in jobs
    if job.get('remote') and 'senior' in job['title'].lower()
]

for job in senior_remote:
    print(f"🔔 Alert: {job['title']} at {job['location']}")
```

### Example 2: Market Research

```python
from Scraper import scrape_jobs
from collections import Counter

companies = ["netflix", "stripe", "airbnb", "shopify"]
all_skills = []

for company in companies:
    jobs = scrape_jobs(f"https://{company}.com/careers")
    for job in jobs:
        # Extract skills from job titles/descriptions
        if 'python' in job['title'].lower():
            all_skills.append('Python')
        if 'react' in job['title'].lower():
            all_skills.append('React')

skill_counts = Counter(all_skills)
print(f"Most in-demand skills: {skill_counts.most_common(10)}")
```

### Example 3: Competitive Analysis

```python
from Scraper import scrape_jobs

competitors = {
    "Company A": "https://companya.com/careers",
    "Company B": "https://companyb.com/careers",
    "Company C": "https://companyc.com/careers"
}

for company, url in competitors.items():
    jobs = scrape_jobs(url)
    engineering = [j for j in jobs if 'engineer' in j['title'].lower()]
    
    print(f"{company}: {len(jobs)} total jobs, {len(engineering)} engineering")
```

## 🔧 Pattern Detection Internals

The scraper uses multiple strategies to detect job listings:

### Strategy 1: Repeating Elements
- Finds elements that repeat with similar structure
- Scores based on content and layout

### Strategy 2: Keyword Analysis
- Looks for job-related keywords (job, position, role, career, etc.)
- Identifies location, department, and type keywords

### Strategy 3: Structural Analysis
- Analyzes heading hierarchy
- Detects links and call-to-action patterns
- Evaluates element complexity

### Strategy 4: Heuristic Scoring
- Combines multiple signals
- Calculates confidence scores
- Selects best matching patterns

## 📈 Confidence Scores

Pattern detection includes confidence scores:

- **0.8-1.0**: High confidence - reliable extraction
- **0.6-0.8**: Medium confidence - usually accurate
- **0.4-0.6**: Low confidence - manual verification recommended
- **<0.4**: Very low - may need manual configuration

```python
analysis = analyze_career_page("https://company.com/careers")

if analysis['container_confidence'] < 0.6:
    print("⚠️  Low confidence - check results carefully")
    print(f"Recommendations: {analysis['recommendations']}")
```

## 🛡️ Error Handling

```python
from Scraper import scrape_jobs, analyze_career_page

try:
    # Check detection quality first
    analysis = analyze_career_page("https://company.com/careers")
    
    if analysis['container_confidence'] < 0.5:
        print("Warning: Low detection confidence")
    
    # Proceed with scraping
    jobs = scrape_jobs("https://company.com/careers")
    
    if not jobs:
        print("No jobs found")
    else:
        print(f"Found {len(jobs)} jobs")
        
except Exception as e:
    print(f"Error: {e}")
```

## 🧪 Testing

```bash
# Run pattern detection tests
python test_scraper.py

# Run universal scraper examples
python Scraper/universal_examples.py
```

## 🔄 Migration from Platform-Specific

If you were using platform-specific scrapers:

**Before (v1.x):**
```python
from Scraper import create_scraper_by_name

scraper = create_scraper_by_name("Netflix")
jobs = scraper.scrape_jobs()
```

**After (v2.x):**
```python
from Scraper import scrape_jobs

jobs = scrape_jobs("https://jobs.netflix.com")
```

Much simpler! The platform-specific scrapers are still available for backward compatibility.

## ⚡ Performance Tips

1. **Cache patterns**: Export/import patterns to skip detection
2. **Use quick_scrape**: For testing or small datasets
3. **Limit max_jobs**: Don't scrape more than you need
4. **Adjust rate_limit_delay**: Balance speed vs. server load

```python
# Fast approach for repeated scrapes
scraper = UniversalCareerScraper("https://company.com/careers")
scraper.export_patterns("patterns.json")  # First time

# Later scrapes (much faster)
scraper = UniversalCareerScraper("https://company.com/careers")
scraper.import_patterns("patterns.json")
jobs = scraper.scrape_jobs()
```

## 📚 API Reference

### Main Functions

**`scrape_jobs(url, max_jobs=100, **filters)`**
- Scrape jobs from any career page
- Auto-detects patterns
- Returns normalized job dicts

**`analyze_career_page(url)`**
- Analyze page structure
- Returns detected patterns and confidence scores

**`quick_scrape(url, limit=50)`**
- Quick scrape with minimal config
- Good for testing

### Classes

**`UniversalCareerScraper(url, config=None, min_confidence=0.6)`**
- Advanced scraper with full control
- Methods: `scrape_jobs()`, `analyze_page()`, `export_patterns()`, `import_patterns()`

**`JobPatternDetector(min_confidence=0.6)`**
- Pattern detection engine
- Methods: `detect_job_container()`, `detect_field_selectors()`, `analyze_page_structure()`

## 🤝 Contributing

Add new detection strategies in `pattern_detector.py`:

```python
def _detect_custom_pattern(self, soup):
    # Your custom detection logic
    return selector, confidence
```

## 📄 License

MIT

## 🆘 Support

For issues:
1. Run `analyze_career_page(url)` to see what was detected
2. Check confidence scores
3. Review recommendations in the analysis output
4. See `universal_examples.py` for more examples

## 🎓 Examples

See `universal_examples.py` for 10 comprehensive examples covering:
1. Simplest usage
2. Filtering
3. Page analysis
4. Advanced features
5. Multi-company scraping
6. Quick scraping
7. Error handling
8. Custom configuration
9. Data processing
10. Integration with databases/files

---

**Bottom Line**: Just use `scrape_jobs("https://any-company.com/careers")` and it works! 🎉
