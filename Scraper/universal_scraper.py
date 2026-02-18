"""
Universal Career Page Scraper.

This scraper can intelligently scrape ANY career page without prior knowledge
of the platform or structure. It uses intelligent pattern detection and
adaptive strategies to extract job listings.
"""

import logging
from typing import List, Dict, Any, Optional
from urllib.parse import urljoin, urlparse
import json

from base_scraper import BaseScraper, ScraperConfig
from pattern_detector import JobPatternDetector

logger = logging.getLogger(__name__)


class UniversalCareerScraper(BaseScraper):
    """
    Universal scraper that works on any career page.
    
    This scraper automatically detects job listing patterns and extracts
    data without requiring platform-specific knowledge or configuration.
    """
    
    def __init__(
        self,
        url: str,
        config: Optional[ScraperConfig] = None,
        auto_detect: bool = True,
        min_confidence: float = 0.6
    ):
        """
        Initialize the universal scraper.
        
        Args:
            url: Base URL of the career page
            config: Scraper configuration
            auto_detect: Automatically detect patterns on first scrape
            min_confidence: Minimum confidence for pattern detection
        """
        super().__init__(config)
        self.url = url.rstrip('/')
        self.platform = "universal"
        self.auto_detect = auto_detect
        self.detector = JobPatternDetector(min_confidence=min_confidence)
        
        # Detected patterns (cached after first detection)
        self.container_selector = None
        self.field_selectors = {}
        self.patterns_detected = False
    
    def scrape_jobs(
        self,
        max_pages: int = 1,
        force_redetect: bool = False,
        **kwargs
    ) -> List[Dict[str, Any]]:
        """
        Scrape jobs from the career page.
        
        Args:
            max_pages: Maximum number of pages to scrape
            force_redetect: Force re-detection of patterns
            **kwargs: Additional query parameters
            
        Returns:
            List of normalized job dictionaries
        """
        all_jobs = []
        
        # Build URL with query parameters
        from query_params import QueryBuilder
        query_builder = QueryBuilder(platform="generic")
        
        for key, value in kwargs.items():
            from query_params import QueryParam
            if hasattr(QueryParam, key.upper()):
               param = getattr(QueryParam, key.upper())
                query_builder.custom_param(param, value)
        
        base_url = query_builder.build_url(self.url)
        
        # Scrape pages
        for page in range(1, max_pages + 1):
            # Add page parameter if needed
            if page > 1:
                page_url = self._add_page_param(base_url, page)
            else:
                page_url = base_url
            
            logger.info(f"Scraping page {page}: {page_url}")
            
            # Fetch the page
            soup = self.fetch_page(page_url)
            if not soup:
                logger.warning(f"Failed to fetch page {page}")
                break
            
            # Detect patterns if needed
            if not self.patterns_detected or force_redetect:
                self._detect_patterns(soup)
            
            # Extract jobs
            jobs = self._extract_jobs(soup)
            
            if not jobs:
                logger.info(f"No jobs found on page {page}, stopping")
                break
            
            all_jobs.extend(jobs)
            logger.info(f"Found {len(jobs)} jobs on page {page}")
        
        logger.info(f"Total jobs scraped: {len(all_jobs)}")
        return all_jobs
    
    def analyze_page(self, url: Optional[str] = None) -> Dict:
        """
        Analyze the page structure and return detected patterns.
        
        This is useful for debugging or understanding what patterns
        were detected.
        
        Args:
            url: URL to analyze (defaults to self.url)
            
        Returns:
            Dictionary with analysis results
        """
        target_url = url or self.url
        soup = self.fetch_page(target_url)
        
        if not soup:
            return {"error": "Failed to fetch page"}
        
        analysis = self.detector.analyze_page_structure(soup)
        
        # Add sample data
        if analysis['container_selector']:
            containers = soup.select(analysis['container_selector'])[:3]
            analysis['sample_jobs'] = []
            
            for container in containers:
                sample = {}
                for field, selector in analysis['field_selectors'].items():
                    sample[field] = self.extract_text(container, selector)
                analysis['sample_jobs'].append(sample)
        
        return analysis
    
    def _detect_patterns(self, soup):
        """Detect job listing patterns on the page."""
        logger.info("Detecting job listing patterns...")
        
        # Detect container
        container_selector, confidence = self.detector.detect_job_container(soup)
        
        if container_selector:
            self.container_selector = container_selector
            logger.info(f"Detected container: {container_selector} (confidence: {confidence:.2f})")
            
            # Detect field selectors
            containers = soup.select(container_selector)[:10]
            field_selectors = self.detector.detect_field_selectors(containers)
            
            self.field_selectors = {
                field: selector
                for field, (selector, conf) in field_selectors.items()
            }
            
            logger.info(f"Detected fields: {list(self.field_selectors.keys())}")
            self.patterns_detected = True
        else:
            logger.warning("Could not detect job listing patterns")
            self.patterns_detected = False
    
    def _extract_jobs(self, soup) -> List[Dict[str, Any]]:
        """Extract job listings from the page."""
        if not self.container_selector:
            logger.warning("No container selector available, using fallback")
            return self._fallback_extraction(soup)
        
        jobs = []
        containers = soup.select(self.container_selector)
        
        for container in containers:
            job = self.parse_job_listing(container)
            if job and job.get('title'):  # Must at least have a title
                jobs.append(self.normalize_job_data(job))
        
        return jobs
    
    def parse_job_listing(self, element) -> Dict[str, Any]:
        """Parse a single job listing element."""
        try:
            job_data = {
                'source_platform': 'universal',
                'raw_data': {'html': str(element)[:500]}  # Truncate to save space
            }
            
            # Extract known fields
            if 'title' in self.field_selectors:
                job_data['title'] = self.extract_text(
                    element, self.field_selectors['title']
                )
            else:
                # Fallback: look for heading
                job_data['title'] = self.extract_text(element, 'h1, h2, h3, h4')
            
            if 'location' in self.field_selectors:
                job_data['location'] = self.extract_text(
                    element, self.field_selectors['location']
                )
            
            if 'department' in self.field_selectors:
                job_data['department'] = self.extract_text(
                    element, self.field_selectors['department']
                )
            
            if 'url' in self.field_selectors:
                job_data['url'] = self.extract_attribute(
                    element, self.field_selectors['url'], 'href'
                )
            else:
                # Fallback: first link
                job_data['url'] = self.extract_attribute(element, 'a', 'href')
            
            # Make URL absolute
            if job_data.get('url') and not job_data['url'].startswith('http'):
                job_data['url'] = urljoin(self.url, job_data['url'])
            
            # Extract additional metadata from text
            text = element.get_text().lower()
            
            # Detect job type
            if any(t in text for t in ['full-time', 'full time', 'fulltime']):
                job_data['job_type'] = 'Full-time'
            elif any(t in text for t in ['part-time', 'part time', 'parttime']):
                job_data['job_type'] = 'Part-time'
            elif 'contract' in text:
                job_data['job_type'] = 'Contract'
            elif 'intern' in text:
                job_data['job_type'] = 'Internship'
            
            # Detect remote
            if any(r in text for r in ['remote', 'work from home', 'wfh']):
                job_data['remote'] = True
            elif 'hybrid' in text:
                job_data['remote'] = 'Hybrid'
            else:
                job_data['remote'] = False
            
            return job_data
            
        except Exception as e:
            logger.error(f"Failed to parse job listing: {e}")
            return {}
    
    def _fallback_extraction(self, soup) -> List[Dict[str, Any]]:
        """
        Fallback extraction when pattern detection fails.
        
        Tries common patterns and heuristics.
        """
        logger.info("Using fallback extraction strategy")
        
        jobs = []
        
        # Try common element patterns
        patterns = [
            'article', '.card', '.item', '.job', '.position',
            '[class*="job"]', '[class*="position"]', '[class*="career"]'
        ]
        
        for pattern in patterns:
            elements = soup.select(pattern)
            if len(elements) >= 3:  # At least 3 similar elements
                logger.info(f"Fallback: trying pattern {pattern}")
                
                for element in elements:
                    # Extract basic info
                    title = self.extract_text(element, 'h1, h2, h3, h4, h5, h6, strong, b')
                    if not title or len(title) < 5:
                        continue
                    
                    url = self.extract_attribute(element, 'a', 'href')
                    if url and not url.startswith('http'):
                        url = urljoin(self.url, url)
                    
                    job = {
                        'title': title,
                        'url': url,
                        'source_platform': 'universal',
                        'raw_data': {'fallback': True}
                    }
                    
                    jobs.append(self.normalize_job_data(job))
                
                if jobs:
                    logger.info(f"Fallback extraction found {len(jobs)} jobs")
                    return jobs
        
        logger.warning("Fallback extraction found no jobs")
        return []
    
    def _add_page_param(self, url: str, page: int) -> str:
        """Add page parameter to URL."""
        separator = '&' if '?' in url else '?'
        
        # Try common pagination patterns
        common_params = ['page', 'p', 'offset', 'start']
        
        # For now, use 'page'
        return f"{url}{separator}page={page}"
    
    def export_patterns(self, filepath: str):
        """
        Export detected patterns to a JSON file for reuse.
        
        Args:
            filepath: Path to save the patterns
        """
        patterns = {
            'url': self.url,
            'container_selector': self.container_selector,
            'field_selectors': self.field_selectors,
            'patterns_detected': self.patterns_detected
        }
        
        with open(filepath, 'w') as f:
            json.dump(patterns, f, indent=2)
        
        logger.info(f"Patterns exported to {filepath}")
    
    def import_patterns(self, filepath: str):
        """
        Import previously detected patterns from a JSON file.
        
        Args:
            filepath: Path to load the patterns from
        """
        with open(filepath, 'r') as f:
            patterns = json.load(f)
        
        self.container_selector = patterns.get('container_selector')
        self.field_selectors = patterns.get('field_selectors', {})
        self.patterns_detected = patterns.get('patterns_detected', False)
        
        logger.info(f"Patterns imported from {filepath}")
    
    def get_pattern_summary(self) -> str:
        """Get a human-readable summary of detected patterns."""
        if not self.patterns_detected:
            return "No patterns detected yet. Run scrape_jobs() to detect patterns."
        
        summary = []
        summary.append(f"Container: {self.container_selector}")
        summary.append(f"Fields detected: {len(self.field_selectors)}")
        for field, selector in self.field_selectors.items():
            summary.append(f"  - {field}: {selector}")
        
        return '\n'.join(summary)


class SmartCareerScraper:
    """
    High-level interface for scraping any career page.
    
    This provides the simplest possible API - just give it a URL
    and it figures out the rest.
    """
    
    @staticmethod
    def scrape(
        url: str,
        max_jobs: int = 100,
        analyze_first: bool = False,
        **filters
    ) -> List[Dict[str, Any]]:
        """
        Scrape jobs from any career page URL.
        
        Args:
            url: Career page URL
            max_jobs: Maximum number of jobs to scrape
            analyze_first: Whether to analyze the page first and show patterns
            **filters: Keyword filters (keywords, location, department, etc.)
            
        Returns:
            List of job dictionaries
        """
        scraper = UniversalCareerScraper(url)
        
        if analyze_first:
            print("\n" + "="*60)
            print("Analyzing page structure...")
            print("="*60)
            analysis = scraper.analyze_page()
            print(json.dumps(analysis, indent=2))
            print("="*60 + "\n")
        
        # Calculate max pages (assuming ~20 jobs per page)
        max_pages = max(1, (max_jobs + 19) // 20)
        
        jobs = scraper.scrape_jobs(max_pages=max_pages, **filters)
        
        return jobs[:max_jobs]
    
    @staticmethod
    def quick_scrape(url: str, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Quick scrape with minimal configuration.
        
        Args:
            url: Career page URL
            limit: Maximum number of jobs
            
        Returns:
            List of job dictionaries
        """
        return SmartCareerScraper.scrape(url, max_jobs=limit)
