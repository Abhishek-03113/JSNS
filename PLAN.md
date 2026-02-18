# Career Page Scraper Implementation Plan

## Executive Summary
A Python-based containerized job scraper that runs on GitHub Actions, scrapes career pages, stores job data in MongoDB Atlas, and sends intelligent email notifications with LLM-powered resume matching.

---

## Research & Key Decisions

### 1. Database Choice: MongoDB Atlas (Free Tier)
**Decision:** Use MongoDB Atlas M0 Free Tier

**Reasoning:**
- GitHub Actions does NOT provide persistent file storage between workflow runs
- Caching expires after 7 days and has restore/save limitations
- Artifacts require workflow run IDs and are not suitable for persistent database storage
- MongoDB Atlas M0 provides:
  - 512 MB storage (sufficient for job listings)
  - Free forever, no credit card required
  - 100 max concurrent connections
  - 10GB in/out bandwidth per week
  - Perfect for job scraping use case

**Implementation Requirements:**
- Store MongoDB connection string in GitHub Secrets
- Use pymongo for database operations
- Collections: `jobs`, `companies`, `scrape_history`

### 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Actions Workflow                   │
│  (Scheduled CRON: Daily at configurable time)               │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│              Career Scraper Container                        │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │             Scraper Module (Orchestrator)             │  │
│  │  ┌─────────────────────────────────────────────┐     │  │
│  │  │     Generic Parser (Primary/Fallback)       │     │  │
│  │  │  • Works on ANY career page                 │     │  │
│  │  │  • HTML parsing with heuristics             │     │  │
│  │  │  • No prior knowledge needed                │     │  │
│  │  └─────────────────────────────────────────────┘     │  │
│  │                       ↑                               │  │
│  │                       │ Fallback if needed            │  │
│  │                       │                               │  │
│  │  ┌─────────────────────────────────────────────┐     │  │
│  │  │    Optional ATS Strategies (Enhancement)    │     │  │
│  │  │  • Greenhouse Strategy                      │     │  │
│  │  │  • Lever Strategy                           │     │  │
│  │  │  • Workday Strategy                         │     │  │
│  │  │  (Only if page matches known ATS pattern)   │     │  │
│  │  └─────────────────────────────────────────────┘     │  │
│  └──────────────────────────────────────────────────────┘  │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  LLM Agent   │  │   Emailer    │  │              │    │
│  │   Module     │→ │   Module     │  │              │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│         │                 │                                │
└─────────┼─────────────────┼────────────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────┐  ┌──────────────┐  ┌─────────────┐
│  MongoDB Atlas  │  │ LLM API      │  │ Gmail SMTP  │
│  (Job Storage)  │  │ (Claude/GPT) │  │ (Sender)    │
└─────────────────┘  └──────────────┘  └─────────────┘

**Key Design Principles:**
- Generic parser is PRIMARY - handles all sites
- ATS strategies are OPTIONAL optimizations
- If strategy fails or doesn't match → automatic fallback to generic
- System is agnostic to career site structure
```

---

## Project Structure

```
career-scraper/
├── .github/
│   └── workflows/
│       └── scrape-jobs.yml              # GitHub Actions workflow
├── src/
│   ├── __init__.py
│   ├── main.py                          # Entry point
│   ├── config/
│   │   ├── __init__.py
│   │   └── settings.py                  # Single config point (loads from env/config.yaml)
│   ├── scraper/
│   │   ├── __init__.py
│   │   ├── base_scraper.py             # Abstract base scraper class
│   │   ├── career_page_scraper.py      # Generic career page scraper
│   │   └── parsers/
│   │       ├── __init__.py
│   │       ├── greenhouse_parser.py     # Greenhouse ATS parser
│   │       ├── lever_parser.py          # Lever ATS parser
│   │       └── workday_parser.py        # Workday ATS parser
│   ├── database/
│   │   ├── __init__.py
│   │   ├── mongodb_client.py           # MongoDB connection & operations
│   │   └── models.py                   # Data models (Job, Company, etc.)
│   ├── llm/
│   │   ├── __init__.py
│   │   ├── resume_analyzer.py          # Resume analysis & scoring
│   │   └── prompts.py                  # LLM prompt templates
│   ├── notification/
│   │   ├── __init__.py
│   │   ├── email_service.py            # Gmail SMTP email sender
│   │   └── templates/
│   │       ├── email_template.html     # HTML email template
│   │       └── email_template.txt      # Plain text fallback
│   └── utils/
│       ├── __init__.py
│       ├── logger.py                   # Logging configuration
│       └── helpers.py                  # Utility functions
├── data/
│   ├── career_pages.txt                # List of career page URLs
│   └── resume.tex                      # User's resume in LaTeX format
├── config.yaml                          # Main configuration file
├── requirements.txt                     # Python dependencies
├── Dockerfile                           # Container definition
├── .env.example                        # Environment variables template
├── .dockerignore
├── .gitignore
├── README.md                           # Project documentation
└── LICENSE
```

---

## Implementation Plan with TODOs

### Phase 1: Project Setup & Configuration

#### TODO 1.1: Initialize Project Structure
- [ ] Create all directories and files as per structure above
- [ ] Initialize git repository
- [ ] Create `.gitignore` with Python, Docker, and sensitive data patterns
- [ ] Create `LICENSE` file (MIT or appropriate license)

#### TODO 1.2: Create Configuration System
**File:** `src/config/settings.py`

```python
"""
Single configuration point for the entire application.
Loads from environment variables and config.yaml file.
"""

# TODO: Implement Settings class with following sections:
# - Database settings (MongoDB connection string)
# - Scraper settings (user agent, timeout, retry logic)
# - LLM settings (API key, model, temperature)
# - Email settings (SMTP server, credentials, recipients)
# - Logging settings (level, format, output)
# - Schedule settings (cron pattern, timezone)

# TODO: Add validation for required settings
# TODO: Support loading from both config.yaml and environment variables
# TODO: Environment variables should override config.yaml values
# TODO: Add settings for which ATS parsers to use
```

**File:** `config.yaml`

```yaml
# TODO: Create configuration with following structure:
# database:
#   mongodb_uri: ${MONGODB_URI}  # From GitHub Secrets
#   database_name: career_scraper
#   collections:
#     jobs: jobs
#     companies: companies
#     history: scrape_history
#
# scraper:
#   user_agent: "Mozilla/5.0 (Career Scraper Bot)"
#   timeout: 30
#   max_retries: 3
#   retry_delay: 5
#   concurrent_requests: 5
#
# llm:
#   provider: anthropic  # or openai
#   api_key: ${LLM_API_KEY}
#   model: claude-sonnet-4-20250514
#   temperature: 0.3
#   max_tokens: 2000
#
# email:
#   smtp_server: smtp.gmail.com
#   smtp_port: 587
#   sender_email: ${SENDER_EMAIL}
#   sender_password: ${SENDER_PASSWORD}  # Gmail App Password
#   recipient_emails:
#     - ${RECIPIENT_EMAIL}
#   subject_prefix: "[Job Alert]"
#
# logging:
#   level: INFO
#   format: "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
#   file: logs/scraper.log
```

**File:** `.env.example`

```bash
# TODO: Create environment template with:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/
# LLM_API_KEY=your_llm_api_key_here
# SENDER_EMAIL=your_email@gmail.com
# SENDER_PASSWORD=your_gmail_app_password
# RECIPIENT_EMAIL=recipient@example.com
```

---

### Phase 2: Database Layer

#### TODO 2.1: Create Data Models
**File:** `src/database/models.py`

```python
"""
Pydantic models for data validation and structure.
"""

# TODO: Define Job model with fields:
# - id (str): Unique job identifier
# - company (str): Company name
# - title (str): Job title
# - location (str): Job location
# - experience (str): Required experience
# - description (str): Job description
# - url (str): Application URL
# - posted_date (datetime): When job was posted
# - scraped_date (datetime): When we scraped it
# - is_new (bool): Whether this is a new job since last scrape
# - ats_type (str): ATS system (greenhouse, lever, workday, etc.)

# TODO: Define Company model with fields:
# - name (str): Company name
# - career_page_url (str): URL to career page
# - last_scraped (datetime): Last scrape timestamp
# - total_jobs (int): Total jobs found
# - ats_type (str): Detected ATS type

# TODO: Define ScrapeHistory model with fields:
# - scrape_id (str): Unique scrape run ID
# - timestamp (datetime): When scrape occurred
# - companies_scraped (int): Number of companies processed
# - jobs_found (int): Total jobs found
# - new_jobs (int): New jobs since last scrape
# - errors (list): Any errors encountered
# - duration_seconds (float): How long scrape took

# TODO: Define ResumeAnalysis model with fields:
# - job_id (str): Reference to job
# - resume_score (float): 0-100 match score
# - strong_matches (list): Matching skills/keywords
# - missing_skills (list): Required but not present
# - keyword_matches (dict): Keyword -> count mapping
# - recommendations (str): LLM recommendations
```

#### TODO 2.2: Implement MongoDB Client
**File:** `src/database/mongodb_client.py`

```python
"""
MongoDB client for database operations.
"""

# TODO: Implement MongoDBClient class with methods:
# - __init__(connection_string, database_name)
# - connect(): Establish connection with retry logic
# - disconnect(): Close connection gracefully
# - insert_job(job: Job): Insert new job
# - update_job(job_id: str, updates: dict): Update existing job
# - get_job_by_id(job_id: str): Retrieve specific job
# - get_jobs_by_company(company: str): Get all jobs for company
# - get_new_jobs(since: datetime): Get jobs added since timestamp
# - mark_jobs_as_seen(job_ids: list): Mark jobs as not new
# - insert_scrape_history(history: ScrapeHistory): Record scrape run
# - get_last_scrape_time(): Get timestamp of last successful scrape
# - upsert_company(company: Company): Insert or update company info
# - create_indexes(): Create necessary database indexes
# - health_check(): Verify database connectivity

# TODO: Add proper error handling and logging
# TODO: Implement connection pooling
# TODO: Add retry logic for transient failures
# TODO: Create compound indexes for efficient queries
```

---

### Phase 3: Web Scraping Layer

**Design Philosophy:**
The scraper uses a **generic parser as the primary mechanism** that can scrape any career page without prior knowledge of its structure. This is the CORE of the system. Optional ATS-specific strategies are enhancements that optimize for well-known platforms but are NOT required for operation. The generic parser must be robust enough to handle 70%+ of career pages on its own.

**Strategy Pattern for Known ATS:**
For commonly used ATS platforms (Greenhouse, Lever, Workday), we implement optional strategy patterns that can extract data more efficiently and reliably when the page structure is recognized. These strategies attempt first, but always fall back to the generic parser if they fail.

---

#### TODO 3.1: Create Generic Career Page Parser
**File:** `src/scraper/generic_parser.py`

```python
"""
Generic parser that can scrape any career page without prior knowledge.
Uses intelligent HTML parsing and heuristics to find job listings.
"""

# TODO: Implement GenericCareerParser class with:
# - __init__(config)
# - fetch_page(url): HTTP request with retry logic using requests/httpx
# - parse_jobs(html, url): Main parsing logic - extract jobs from any career page
# - detect_job_listings(soup): Find sections likely containing job listings
#   * Look for common patterns: lists, tables, cards, repeated elements
#   * Search for keywords: "jobs", "careers", "positions", "openings"
#   * Identify container elements with multiple similar children
# - extract_job_details(element): Extract job info from a single listing
#   * Title: Look for h1-h4 tags, large text, links with job keywords
#   * Location: Search for location indicators (city names, "remote", country codes)
#   * Description: Extract text content, prefer paragraphs near title
#   * URL: Extract href from links, handle relative URLs
#   * Posted date: Look for dates, "posted", "updated" keywords
# - clean_and_validate(job_data): Ensure required fields present, clean text
# - detect_pagination(soup): Find "next page" links if multi-page
# - rate_limit(): Implement polite delays between requests (2-5 seconds)

# TODO: Use BeautifulSoup4 for HTML parsing
# TODO: Implement heuristics:
#   * Job titles usually in headings or bold text
#   * Multiple similar elements = likely job listings
#   * Links containing "job", "position", "apply" = job URLs
#   * Structured data (JSON-LD) if present
# TODO: Add user-agent rotation and request headers
# TODO: Implement exponential backoff for retries
# TODO: Log parsing decisions for debugging
# TODO: Handle both client-side and server-side rendered pages
```

#### TODO 3.2: Implement Strategy Pattern for Known ATS (Optional Enhancement)
**File:** `src/scraper/parsers/ats_strategy.py`

```python
"""
Strategy pattern for optimized parsing of known ATS systems.
Falls back to generic parser if strategy doesn't work.
"""

# TODO: Implement ATSParserStrategy abstract class:
# - matches(html, url): Returns True if this strategy can handle the page
# - parse(html, url): Parse using ATS-specific knowledge
# - get_name(): Return ATS name (greenhouse, lever, workday)

# TODO: Implement GreenhouseStrategy:
# - matches(): Check for greenhouse.io domain or JSON API
# - parse(): Use /embed/jobs.json endpoint or specific CSS selectors
# - Extract: job_id, title, location, departments from Greenhouse structure

# TODO: Implement LeverStrategy:
# - matches(): Check for lever.co domain or specific classes
# - parse(): Use Lever's JSON endpoint or HTML structure
# - Handle Lever's specific data format

# TODO: Implement WorkdayStrategy:
# - matches(): Check for myworkdayjobs.com domain
# - parse(): Handle Workday's complex dynamic structure
# - May need Playwright for JavaScript rendering

# TODO: Each strategy should:
#   * Return standardized Job objects
#   * Handle errors gracefully and return None on failure
#   * Log when strategy is used
```

#### TODO 3.3: Create Parser Orchestrator with Strategy Selection
**File:** `src/scraper/career_page_scraper.py`

```python
"""
Main scraper orchestrator that tries strategies before falling back to generic.
"""

# TODO: Implement CareerPageScraper class with:
# - __init__(database_client, config)
# - available_strategies: List of ATS strategies (optional)
# - generic_parser: Always-available fallback GenericCareerParser
# 
# - scrape_all(): Main entry point
#   * Read URLs from data/career_pages.txt
#   * Use ThreadPoolExecutor for concurrent scraping (configurable)
#   * Call scrape_single_page for each URL
#   * Aggregate results and statistics
# 
# - scrape_single_page(url): Scrape one career page
#   * Fetch HTML content
#   * Try each available strategy in order:
#     - If strategy.matches(html, url): use strategy.parse()
#     - If strategy succeeds: use results
#     - If strategy fails: log and try next
#   * If no strategy works or none match: use generic_parser.parse_jobs()
#   * Return list of Job objects
# 
# - compare_with_previous(): Query database for last scrape
#   * Compare job IDs to find new jobs
#   * Mark jobs as new or existing
# 
# - save_to_database(jobs): Batch insert/update jobs in MongoDB
# 
# - generate_scrape_report(): Summary statistics
#   * Total URLs scraped
#   * Jobs found (new vs existing)
#   * Which parsers were used (strategy vs generic)
#   * Errors encountered
#   * Duration

# TODO: Configuration for enabling/disabling strategies
# TODO: Fallback chain: Strategy 1 → Strategy 2 → ... → Generic
# TODO: Log which parser was used for each URL (for monitoring)
# TODO: Handle network errors, timeouts gracefully
# TODO: Implement request pooling for efficiency
# TODO: Add dry-run mode that doesn't save to database
```

---

### Phase 4: LLM Resume Analysis

#### TODO 4.1: Create LLM Prompt Templates
**File:** `src/llm/prompts.py`

```python
"""
Prompt templates for LLM resume analysis.
"""

# TODO: Create RESUME_ANALYSIS_PROMPT template:
# - Input: Resume text, Job description, Job title, Required skills
# - Output: JSON with score, strong_matches, missing_skills, keywords, recommendations
# - Prompt should ask for:
#   * Overall match score (0-100)
#   * Strong skill/experience matches (list)
#   * Missing critical skills (list)
#   * Keyword match analysis (dict)
#   * Tailoring recommendations (string)
# - Use structured output format for easy parsing

# TODO: Create SKILL_EXTRACTION_PROMPT:
# - Extract skills from job description
# - Categorize as: required, preferred, nice-to-have

# TODO: Create RESUME_SUMMARY_PROMPT:
# - Summarize resume into key skills and experiences
# - Cache this to avoid re-processing for every job
```

#### TODO 4.2: Implement Resume Analyzer
**File:** `src/llm/resume_analyzer.py`

```python
"""
LLM-powered resume analysis and job matching.
"""

# TODO: Implement ResumeAnalyzer class with:
# - __init__(api_key, model, config)
# - analyze_job_match(resume: str, job: Job): Main analysis method
# - extract_skills_from_jd(description: str): Extract skills from JD
# - calculate_keyword_overlap(resume: str, jd: str): Count keyword matches
# - parse_llm_response(response: str): Parse JSON from LLM
# - batch_analyze(resume: str, jobs: List[Job]): Analyze multiple jobs efficiently

# TODO: Support both Anthropic Claude and OpenAI GPT
# TODO: Implement caching for resume summary (don't re-analyze resume each time)
# TODO: Add retry logic for API failures
# TODO: Parse and validate JSON responses
# TODO: Handle rate limits gracefully
# TODO: Add cost tracking (log tokens used)
```

---

### Phase 5: Email Notification System

#### TODO 5.1: Create Email Templates
**File:** `src/notification/templates/email_template.html`

```html
<!-- TODO: Create HTML email template with:
  - Professional header with company logo/branding
  - Summary section: Total new jobs found, date range
  - Job cards for each new job with:
    * Company name (bold)
    * Job title (large, linked to URL)
    * Location | Experience level | Posted date
    * Resume match score (color-coded: green >70, yellow 50-70, red <50)
    * Strong matches (green badges)
    * Missing skills (orange badges)
    * Top keyword matches (list)
    * Collapsible job description section
    * Clear "Apply Now" CTA button
  - Footer with unsubscribe info, timestamp, powered by info
  - Responsive design for mobile
  - Professional color scheme
-->
```

**File:** `src/notification/templates/email_template.txt`

```text
TODO: Create plain text version of email for fallback
- Same information as HTML but formatted for text-only clients
- Use ASCII art or symbols for visual separation
- Include all URLs as clickable links
```

#### TODO 5.2: Implement Email Service
**File:** `src/notification/email_service.py`

```python
"""
Email notification service using Gmail SMTP.
"""

# TODO: Implement EmailService class with:
# - __init__(smtp_config, templates)
# - send_job_alert(new_jobs: List[Job], analyses: List[ResumeAnalysis]): Main method
# - render_html_email(jobs, analyses): Render HTML from template
# - render_text_email(jobs, analyses): Render plain text version
# - send_email(recipient, subject, html_body, text_body): Send via SMTP
# - format_job_card(job, analysis): Format individual job section
# - color_code_score(score): Return color based on match score
# - test_connection(): Test SMTP connectivity

# TODO: Use email.mime for multipart messages (HTML + text)
# TODO: Support multiple recipients
# TODO: Add email delivery retry logic
# TODO: Log all email sends with status
# TODO: Handle Gmail App Password authentication
# TODO: Support attachments (optional: resume PDF)
```

---

### Phase 6: Main Application Entry Point

#### TODO 6.1: Create Main Execution Script
**File:** `src/main.py`

```python
"""
Main entry point for the career scraper application.
"""

# TODO: Implement main() function with following flow:
# 1. Load configuration from config.yaml and environment
# 2. Initialize logger
# 3. Connect to MongoDB
# 4. Initialize generic parser and optional ATS strategies
# 5. Load resume from .tex file and extract plain text using pylatexenc
# 6. Execute scraping for all career pages
# 7. Get list of new jobs since last scrape
# 8. If new jobs found and resume provided:
#    - Initialize LLM analyzer
#    - Analyze each new job against resume
#    - Generate match scores and recommendations
# 9. If new jobs found:
#    - Initialize email service
#    - Send email notification with job details and analysis
# 10. Save scrape history to database
# 11. Log summary statistics
# 12. Exit with appropriate status code

# TODO: Add command-line arguments:
# --config: Path to config file (default: config.yaml)
# --resume: Path to resume file (default: data/resume.tex)
# --dry-run: Don't send emails, just print to console
# --verbose: Enable debug logging
# --skip-llm: Skip resume analysis
# --test-email: Send test email without scraping

# TODO: Implement proper error handling at each step
# TODO: Use try-except-finally to ensure DB disconnection
# TODO: Log to both file and console
# TODO: Create execution summary report
# TODO: Add function to extract text from .tex using pylatexenc
```

#### TODO 6.2: Create Utility Modules
**File:** `src/utils/logger.py`

```python
"""
Centralized logging configuration.
"""

# TODO: Implement setup_logger() function:
# - Create logger with name from settings
# - Configure file handler (rotating file)
# - Configure console handler (colored output)
# - Set log level from config
# - Add custom formatter with timestamp, level, message
# - Return configured logger instance
```

**File:** `src/utils/helpers.py`

```python
"""
Utility helper functions.
"""

# TODO: Implement helper functions:
# - parse_date(date_string): Parse various date formats to datetime
# - generate_job_id(company, title, url): Create unique job identifier
# - sanitize_filename(text): Clean text for use in filenames
# - truncate_text(text, max_length): Truncate with ellipsis
# - extract_domain(url): Get domain from URL
# - is_valid_url(url): Validate URL format
# - read_text_file(path): Read text file with encoding handling
# - calculate_similarity(text1, text2): Basic text similarity score
```

---

### Phase 7: Containerization

#### TODO 7.1: Create Dockerfile
**File:** `Dockerfile`

```dockerfile
# TODO: Create multi-stage Dockerfile:
# Stage 1: Builder
# - Use python:3.11-slim as base
# - Install build dependencies
# - Copy requirements.txt
# - Install Python packages
# 
# Stage 2: Runtime
# - Use python:3.11-slim
# - Copy installed packages from builder
# - Copy application code
# - Set working directory to /app
# - Create non-root user for security
# - Set environment variables for Python
# - Set ENTRYPOINT to python src/main.py
# 
# TODO: Optimize for small image size
# TODO: Add HEALTHCHECK instruction
# TODO: Add labels for metadata
```

#### TODO 7.2: Create Dependencies File
**File:** `requirements.txt`

```text
# TODO: Add all required packages with versions:
# Web scraping:
# - requests>=2.31.0
# - beautifulsoup4>=4.12.0
# - lxml>=4.9.0
# - playwright>=1.40.0 (optional, for JavaScript-heavy sites like Workday)
#
# Database:
# - pymongo>=4.6.0
#
# Data validation:
# - pydantic>=2.5.0
# - python-dateutil>=2.8.2
#
# Resume processing:
# - pylatexenc>=2.10 (for .tex to text conversion)
#
# LLM:
# - anthropic>=0.40.0
# - openai>=1.50.0 (optional)
#
# Email:
# - jinja2>=3.1.2 (for email templates)
#
# Configuration:
# - pyyaml>=6.0
# - python-dotenv>=1.0.0
#
# Utilities:
# - colorlog>=6.8.0 (colored logging)
```

---

### Phase 8: GitHub Actions Workflow

#### TODO 8.1: Create GitHub Actions Workflow
**File:** `.github/workflows/scrape-jobs.yml`

```yaml
# TODO: Create workflow with:
# name: Daily Job Scraper
#
# on:
#   schedule:
#     - cron: '0 9 * * *'  # Daily at 9 AM UTC (configurable)
#   workflow_dispatch:  # Allow manual trigger
#
# env:
#   MONGODB_URI: ${{ secrets.MONGODB_URI }}
#   LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
#   SENDER_EMAIL: ${{ secrets.SENDER_EMAIL }}
#   SENDER_PASSWORD: ${{ secrets.SENDER_PASSWORD }}
#   RECIPIENT_EMAIL: ${{ secrets.RECIPIENT_EMAIL }}
#
# jobs:
#   scrape-and-notify:
#     runs-on: ubuntu-latest
#     
#     steps:
#       - name: Checkout repository
#         uses: actions/checkout@v4
#       
#       - name: Set up Docker Buildx
#         uses: docker/setup-buildx-action@v3
#       
#       - name: Build Docker image
#         run: docker build -t career-scraper .
#       
#       - name: Run scraper
#         run: |
#           docker run --rm \
#             -e MONGODB_URI \
#             -e LLM_API_KEY \
#             -e SENDER_EMAIL \
#             -e SENDER_PASSWORD \
#             -e RECIPIENT_EMAIL \
#             -v ${{ github.workspace }}/data:/app/data \
#             career-scraper
#       
#       - name: Upload logs (on failure)
#         if: failure()
#         uses: actions/upload-artifact@v4
#         with:
#           name: scraper-logs
#           path: logs/
#           retention-days: 7
#
# TODO: Add job to test email configuration
# TODO: Add job to validate career pages list
# TODO: Consider adding cache for Docker layers
# TODO: Add notification on workflow failure (GitHub Actions notifications)
```

---

### Phase 9: Data Files

#### TODO 9.1: Create Career Pages List
**File:** `data/career_pages.txt`

```text
# TODO: Create format:
# One URL per line
# Comments start with #
# Empty lines ignored
# Example:
# https://boards.greenhouse.io/company1
# https://jobs.lever.co/company2
# https://company3.wd1.myworkdayjobs.com/careers
#
# TODO: Add validation in scraper to check URL format
# TODO: Support company name extraction from URL or inline comments
# TODO: Consider switching to YAML/JSON for richer metadata
```

#### TODO 9.2: Create Resume File
**File:** `data/resume.tex`

```text
# TODO: Add instructions in README:
# - Format: LaTeX (.tex) format
# - Include: Skills, experience, education, certifications
# - Be comprehensive - more detail = better matching
# - Update regularly
# - Use pylatexenc or similar library to extract plain text from .tex for analysis
```

---

### Phase 10: Documentation

#### TODO 10.1: Create Single Aggregate Documentation
**File:** `README.md`

```markdown
# TODO: Create comprehensive single-file documentation including:

## 1. Project Overview
- What it does
- Key features  
- Architecture diagram showing: GitHub Actions → Generic Parser (with optional ATS strategies) → MongoDB → LLM → Email

## 2. Quick Start
- Prerequisites (Python 3.11+, MongoDB Atlas, Gmail App Password, LLM API key)
- Clone and setup commands
- Configuration in 5 minutes

## 3. Configuration Reference
- config.yaml structure and all options
- Environment variables (GitHub Secrets)
- Career pages list format (data/career_pages.txt)
- Resume setup (.tex format, extraction notes)

## 4. Architecture Deep Dive
- Generic parser approach (works on any career page)
- Optional ATS strategies (Greenhouse, Lever, Workday)
- Strategy pattern fallback chain
- MongoDB schema (jobs, companies, scrape_history)
- LLM resume matching workflow
- Email notification structure

## 5. Running Locally
- Python venv setup
- Run scraper manually
- Test modes (--dry-run, --skip-llm, --test-email)
- Debugging tips

## 6. GitHub Actions Deployment  
- Setting up secrets
- Workflow trigger configuration
- Monitoring runs
- Viewing logs

## 7. How It Works
- Scraping flow (generic parser heuristics)
- Job deduplication logic
- Resume analysis process
- Email template structure with scores

## 8. Customization Guide
- Adding new ATS strategies
- Modifying email template
- Adjusting scraping frequency
- Tuning LLM prompts

## 9. Troubleshooting
- Common parsing issues
- Database connection problems
- Email delivery failures
- LLM API errors
- Rate limiting

## 10. Project Structure
- Brief overview of src/ modules
- Key files and their purpose

## 11. Future Enhancements
- Possible improvements
- Contributing guidelines

# TODO: Add inline code examples where helpful
# TODO: Include screenshots of email output
# TODO: Add FAQ section for common questions
# TODO: Keep it practical and focused - no excessive theory
```

---

## Implementation Order & Milestones

### Milestone 1: Foundation (Days 1-2)
1. Set up project structure (TODO 1.1)
2. Create configuration system (TODO 1.2)
3. Set up logging (TODO 6.2)

### Milestone 2: Database Layer (Days 3-4)
1. Define data models (TODO 2.1)
2. Implement MongoDB client (TODO 2.2)
3. Set up MongoDB Atlas and test connection

### Milestone 3: Web Scraping (Days 5-8)
1. Implement generic career parser (TODO 3.1)
2. Create optional ATS strategy pattern and implementations (TODO 3.2)
3. Build main scraper orchestrator with strategy selection (TODO 3.3)
4. Add helper utilities (TODO 6.2)
5. Test with sample career pages (various ATS types and generic sites)

### Milestone 4: LLM Integration (Days 9-10)
1. Create prompt templates (TODO 4.1)
2. Implement resume analyzer with .tex support (TODO 4.2)
3. Test with sample resume and jobs

### Milestone 5: Email System (Days 11-12)
1. Design email templates (TODO 5.1)
2. Implement email service (TODO 5.2)
3. Test email rendering and delivery

### Milestone 6: Integration (Days 13-14)
1. Create main entry point (TODO 6.1)
2. Integrate all components
3. End-to-end testing
4. Bug fixes and refinements

### Milestone 7: Containerization (Days 15-16)
1. Create Dockerfile (TODO 7.1)
2. Build and test container locally
3. Optimize container size
4. Test with environment variables

### Milestone 8: CI/CD (Days 17-18)
1. Set up GitHub Actions workflow (TODO 8.1)
2. Configure GitHub Secrets
3. Test workflow execution
4. Set up monitoring and alerts

### Milestone 9: Documentation (Days 19-20)
1. Create sample career pages list (TODO 9.1)
2. Add resume template in .tex format (TODO 9.2)
3. Write comprehensive single aggregate README (TODO 10.1)
4. Create quick start guide and examples

---

## Technical Considerations

### Scraping Best Practices
- **Respect robots.txt**: Check and honor robots.txt files
- **Rate limiting**: Don't hammer servers, space out requests (2-5 seconds)
- **User agent**: Use descriptive user agent identifying the bot
- **Error handling**: Graceful degradation on parsing failures
- **Caching**: Cache career page structure to detect ATS changes

### Security
- **Secrets management**: Never commit API keys or passwords
- **GitHub Secrets**: Store all sensitive data in GitHub Secrets
- **MongoDB security**: Use IP whitelist and strong passwords
- **Gmail App Password**: Never use actual Gmail password, only App Passwords

### Performance Optimization
- **Concurrent scraping**: Use ThreadPoolExecutor with configurable workers
- **Database indexing**: Create indexes on frequently queried fields
- **LLM batching**: Analyze multiple jobs in single LLM call when possible
- **Resume caching**: Cache resume summary to avoid reprocessing
- **Connection pooling**: Reuse database and HTTP connections

### Monitoring
- **Scrape success rate**: Track successful vs failed scrapes
- **Job discovery rate**: Monitor new jobs found per run
- **LLM costs**: Track API usage and costs
- **Email delivery**: Monitor email send success rate
- **Error tracking**: Log all errors with context

---

## Future Enhancements

### Short-term
- [ ] Add support for more ATS systems (SmartRecruiters, Ashby, etc.)
- [ ] Implement email preferences (frequency, job filters)
- [ ] Add web dashboard for browsing jobs
- [ ] Support multiple resumes (different roles)
- [ ] Add job alert filtering (location, seniority, keywords)

### Medium-term
- [ ] Machine learning for better job matching
- [ ] Browser extension for one-click apply
- [ ] Mobile app for job notifications
- [ ] Integration with job boards (LinkedIn, Indeed)
- [ ] Collaborative features (share job opportunities)

### Long-term
- [ ] AI-powered application generation
- [ ] Interview preparation suggestions
- [ ] Salary data integration
- [ ] Company culture insights
- [ ] Career path recommendations

---

## Estimated Time to Complete

- **Total Implementation Time**: 12-16 working days
- **Documentation**: 2-3 days
- **Total Project Duration**: 14-19 days

*Note: Testing can be added later as needed*

---

## Success Metrics

1. **Scraping Coverage**: Generic parser successfully extracts jobs from >85% of provided URLs
2. **Job Discovery**: Identify all new jobs posted since last scrape with <5% miss rate
3. **Matching Accuracy**: Resume match scores correlate with actual fit (manual validation)
4. **Reliability**: <2% failure rate on scheduled runs
5. **Performance**: Complete full scrape cycle in <15 minutes for 50 companies
6. **Email Delivery**: 100% email delivery success rate
7. **Cost Efficiency**: Stay within MongoDB and LLM free tiers
8. **Generic Parser Effectiveness**: Successfully parse at least 70% of sites without needing ATS strategies

---

## Risk Mitigation

### Risk: Career page structure changes
**Mitigation**: 
- Implement generic fallback parser
- Add alerts for parsing failures
- Regular testing with real pages

### Risk: LLM API rate limits
**Mitigation**:
- Implement exponential backoff
- Add request queuing
- Consider caching results

### Risk: Email marked as spam
**Mitigation**:
- Use professional HTML formatting
- Include unsubscribe option
- Test with multiple email clients
- Consider using SendGrid/Mailgun

### Risk: MongoDB free tier limits exceeded
**Mitigation**:
- Implement data retention policy
- Archive old jobs
- Monitor storage usage
- Have upgrade path ready

---

## Notes for LLM Implementation Agent

When implementing this plan:

1. **Incremental development**: Complete one TODO at a time, test manually
2. **Logging first**: Add logging to every major function for debugging
3. **Type hints**: Use type hints everywhere for better code clarity
4. **Error handling**: Wrap risky operations in try-except blocks
5. **Configuration**: Make everything configurable, avoid hardcoding
6. **Documentation**: Document as you go with clear docstrings
7. **Git commits**: Make small, focused commits with clear messages
8. **Dependencies**: Pin exact versions in requirements.txt
9. **Security**: Double-check no secrets are committed
10. **Generic parser first**: Implement the generic parser thoroughly before adding ATS strategies
11. **Strategy pattern optional**: ATS strategies are enhancements; generic parser must work standalone
12. **Resume extraction**: Use pylatexenc to convert .tex to plain text for LLM analysis

---

## Quick Start Commands

```bash
# Local development setup
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Run locally
python src/main.py --config config.yaml --resume data/resume.tex

# Run in dry-run mode (no emails sent)
python src/main.py --dry-run

# Build container
docker build -t career-scraper .

# Run container
docker run --env-file .env career-scraper

# Deploy to GitHub Actions
git add .github/workflows/scrape-jobs.yml
git commit -m "Add GitHub Actions workflow"
git push origin main
# Configure secrets in GitHub repository settings
```

---

**END OF IMPLEMENTATION PLAN**
