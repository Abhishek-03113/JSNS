# Universal Career Page Scraper - Setup & Installation

## 🚀 Quick Start

```bash
# Install dependencies
pip install requests beautifulsoup4

# Test the module
python test_scraper.py

# Run examples
python Scraper/universal_examples.py
```

## ✨ What's New - Version 2.0

**The scraper now works on ANY career page automatically!**

No more platform-specific scrapers. No more manual configuration. Just give it a URL:

```python
from Scraper import scrape_jobs

# Works on ANY company's career page!
jobs = scrape_jobs("https://company.com/careers")
```

## Dependencies

- `requests` - HTTP library for making web requests
- `beautifulsoup4` - HTML/XML parsing

## Directory Structure

```
Scraper/
├── __init__.py                 # Package exports & main API
├── universal_scraper.py        # ⭐ Universal scraper (NEW!)
├── pattern_detector.py         # ⭐ Intelligent pattern detection (NEW!)
├── base_scraper.py             # Base scraper class
├── career_scraper.py           # Legacy platform implementations
├── config.py                   # Company registry (legacy)
├── query_params.py             # Query parameter system
├── universal_examples.py       # ⭐ Universal scraper examples (NEW!)
├── examples.py                 # Legacy examples
├── UNIVERSAL_README.md         # ⭐ Full universal scraper docs (NEW!)
└── README.md                   # Original documentation
```

## 🎯 Main Features

### ⭐ Universal Scraping (NEW!)
- **Works on ANY career page** - No platform knowledge required
- **Automatic pattern detection** - Finds job listings intelligently
- **Zero configuration** - Just provide a URL
- **Adaptive learning** - Caches patterns for speed

```python
from Scraper import scrape_jobs

# Scrape Netflix jobs
jobs = scrape_jobs("https://jobs.netflix.com")

# Scrape Stripe jobs
jobs = scrape_jobs("https://stripe.com/careers")

# Scrape ANY company
jobs = scrape_jobs("https://any-company.com/careers")
```

### 🧠 Intelligent Pattern Detection
- Analyzes page structure automatically
- Identifies repeating job listing patterns
- Detects field selectors (title, location, URL)
- Provides confidence scores

```python
from Scraper import analyze_career_page

# See what patterns were detected
analysis = analyze_career_page("https://company.com/careers")
print(f"Detected {analysis['estimated_job_count']} jobs")
print(f"Confidence: {analysis['container_confidence']}")
```

### 🎨 Flexible Filtering
- Apply filters that work across all platforms
- Keywords, location, department, etc.

```python
jobs = scrape_jobs(
    "https://company.com/careers",
    keywords="software engineer",
    location="Remote",
    max_jobs=50
)
```

## 📝 Simple Usage Examples

### Example 1: Basic Scraping (One Line!)

```python
from Scraper import scrape_jobs

# That's it! Works on any career page
jobs = scrape_jobs("https://company.com/careers")

for job in jobs:
    print(f"{job['title']} - {job['location']}")
```

### Example 2: With Filters

```python
# Filter by keywords and location
jobs = scrape_jobs(
    "https://company.com/careers",
    keywords="python engineer",
    location="San Francisco",
    max_jobs=50
)
```

### Example 3: Analyze First

```python
from Scraper import analyze_career_page

# See what the scraper detects
analysis = analyze_career_page("https://company.com/careers")
print(f"Container: {analysis['container_selector']}")
print(f"Confidence: {analysis['container_confidence']}")
print(f"Found {analysis['estimated_job_count']} jobs")
```

### Example 4: Multiple Companies

```python
from Scraper import scrape_jobs

companies = [
    "https://jobs.netflix.com",
    "https://stripe.com/careers",
    "https://careers.airbnb.com"
]

all_jobs = []
for url in companies:
    jobs = scrape_jobs(url, max_jobs=25)
    all_jobs.extend(jobs)

print(f"Total jobs: {len(all_jobs)}")
```

### Example 5: Quick Testing

```python
from Scraper import quick_scrape

# Get first 20 jobs quickly for testing
jobs = quick_scrape("https://company.com/careers", limit=20)
```

## 🎯 How It Works

The universal scraper uses intelligent pattern detection:

```
┌──────────────────────────────┐
│  1. Fetch Career Page        │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  2. Pattern Detection        │
│     • Find repeating elements│
│     • Analyze structure      │
│     • Score candidates       │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  3. Extract Job Data         │
│     • Title, Location, URL   │
│     • Department, Type, etc. │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  4. Normalize & Return       │
│     • Consistent format      │
│     • Clean data             │
└──────────────────────────────┘
```

**No platform knowledge needed!** The scraper:
- Analyzes HTML structure
- Identifies repeating patterns
- Detects field selectors
- Extracts and normalizes data

## 🔧 Advanced Features

### Export/Import Patterns

Speed up repeated scrapes by caching detected patterns:

```python
from Scraper import UniversalCareerScraper

# First scrape - detects patterns
scraper = UniversalCareerScraper("https://company.com/careers")
jobs = scraper.scrape_jobs()

# Save patterns
scraper.export_patterns("company_patterns.json")

# Later scrapes - much faster!
scraper = UniversalCareerScraper("https://company.com/careers")
scraper.import_patterns("company_patterns.json")
jobs = scraper.scrape_jobs()  # No detection needed!
```

### Custom Configuration

```python
from Scraper import UniversalCareerScraper, ScraperConfig

config = ScraperConfig(
    timeout=60,
    max_retries=5,
    rate_limit_delay=2.0
)

scraper = UniversalCareerScraper(
    "https://company.com/careers",
    config=config,
    min_confidence=0.7  # Higher threshold
)

jobs = scraper.scrape_jobs(max_pages=3)
```

## 🆚 Comparison: Old vs New

### Before (v1.x) - Platform-Specific
```python
# Had to know the platform
from Scraper import create_scraper_by_name, add_company, Platform

# Add company with platform type
add_company("MyCompany", "https://...", Platform.GREENHOUSE)

# Create platform-specific scraper
scraper = create_scraper_by_name("MyCompany")
jobs = scraper.scrape_jobs()
```

### Now (v2.x) - Universal
```python
# Just give it a URL!
from Scraper import scrape_jobs

jobs = scrape_jobs("https://any-company.com/careers")
```

**Much simpler!** The old way still works for backward compatibility.

## 📊 Supported Platforms

The universal scraper automatically handles:

✅ **Greenhouse** (Netflix, Airbnb, etc.)  
✅ **Lever** (Stripe, Shopify, etc.)  
✅ **Workday** (Enterprise companies)  
✅ **Custom Platforms** (Any HTML structure)  
✅ **Unknown Platforms** (Auto-detects patterns)

## 🧪 Testing

```bash
# Test imports and basic functionality
python test_scraper.py

# Run universal scraper examples
python Scraper/universal_examples.py

# Test with a real URL (replace with actual URL)
python -c "from Scraper import scrape_jobs; jobs = scrape_jobs('https://example.com/careers'); print(f'Found {len(jobs)} jobs')"
```

## 📚 Documentation

- **[UNIVERSAL_README.md](Scraper/UNIVERSAL_README.md)** - Full universal scraper documentation
- **[universal_examples.py](Scraper/universal_examples.py)** - 10 comprehensive examples
- **[README.md](Scraper/README.md)** - Original documentation (v1.x features)

## 💡 Quick Tips

1. **Start simple**: Use `scrape_jobs(url)` - it just works!
2. **Check confidence**: Use `analyze_career_page(url)` if results seem off
3. **Cache patterns**: Export/import for faster repeated scrapes
4. **Filter smartly**: Add filters to get only what you need
5. **Handle errors**: Check confidence scores and recommendations

## 🔍 Troubleshooting

### Low Confidence Detection

```python
from Scraper import analyze_career_page

analysis = analyze_career_page("https://company.com/careers")

if analysis['container_confidence'] < 0.6:
    print("⚠️  Low confidence")
    print("Recommendations:", analysis['recommendations'])
    
    # Try scraping anyway - it often still works
    from Scraper import scrape_jobs
    jobs = scrape_jobs("https://company.com/careers")
```

### No Jobs Found

```python
from Scraper import scrape_jobs, analyze_career_page

# First, analyze to see what's detected
analysis = analyze_career_page("https://company.com/careers")
print(json.dumps(analysis, indent=2))

# Check if container was found
if not analysis['container_selector']:
    print("Could not detect job container")
    print("The page might use dynamic loading (JavaScript)")
```

### Dynamic/JavaScript Pages

For pages that load jobs via JavaScript, you may need:
- Selenium or Playwright for browser automation
- Check if the site has an API endpoint

## 🚀 Next Steps

1. **Install dependencies**: `pip install requests beautifulsoup4`
2. **Test the module**: `python test_scraper.py`
3. **Try examples**: `python Scraper/universal_examples.py`
4. **Read docs**: Check [UNIVERSAL_README.md](Scraper/UNIVERSAL_README.md)
5. **Start scraping**: `scrape_jobs("https://your-company.com/careers")`

## 🎓 Learning Path

1. Start with `scrape_jobs()` - simplest API
2. Use `analyze_career_page()` - understand detection
3. Try `UniversalCareerScraper` - advanced control
4. Export/import patterns - optimize performance
5. Integrate with your workflow - CSV, JSON, database

## 📦 Export Data

```python
import json
import csv

jobs = scrape_jobs("https://company.com/careers", max_jobs=100)

# JSON
with open('jobs.json', 'w') as f:
    json.dump(jobs, f, indent=2)

# CSV  
with open('jobs.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['title', 'location', 'url'])
    writer.writeheader()
    writer.writerows(jobs)
```

## 🎉 Summary

**The scraper is now truly universal!**

- ✅ Works on ANY career page
- ✅ No configuration needed
- ✅ Intelligent pattern detection
- ✅ One-line usage: `scrape_jobs(url)`
- ✅ Backward compatible with v1.x

**Get started**: `pip install requests beautifulsoup4 && python test_scraper.py`
