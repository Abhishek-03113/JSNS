"""
Intelligent Pattern Detection for Career Pages.

This module automatically detects job listing patterns on any career page
without requiring platform-specific knowledge.
"""

import re
import logging
from typing import List, Dict, Tuple, Optional, Set
from bs4 import BeautifulSoup, Tag
from collections import Counter, defaultdict

logger = logging.getLogger(__name__)


class JobPatternDetector:
    """
    Intelligently detects job listing patterns on career pages.

    Uses heuristics, structural analysis, and pattern matching to identify
    job listings without prior knowledge of the platform.
    """

    # Keywords commonly found in job listings
    JOB_KEYWORDS = [
        "job",
        "position",
        "role",
        "career",
        "opening",
        "vacancy",
        "opportunity",
        "hiring",
        "employment",
        "post",
        "listing",
    ]

    # Location keywords
    LOCATION_KEYWORDS = [
        "location",
        "city",
        "office",
        "place",
        "where",
        "region",
        "country",
        "state",
        "remote",
        "hybrid",
        "onsite",
        "campus",
    ]

    # Department/team keywords
    DEPARTMENT_KEYWORDS = [
        "department",
        "team",
        "division",
        "group",
        "category",
        "function",
        "area",
        "unit",
        "engineering",
        "sales",
        "marketing",
    ]

    # Job type keywords
    TYPE_KEYWORDS = [
        "full-time",
        "part-time",
        "contract",
        "temporary",
        "internship",
        "fulltime",
        "parttime",
        "full time",
        "part time",
        "permanent",
    ]

    def __init__(self, min_confidence: float = 0.6):
        """
        Initialize the pattern detector.

        Args:
            min_confidence: Minimum confidence score (0-1) to consider a pattern valid
        """
        self.min_confidence = min_confidence
        self.detected_patterns = {}

    def detect_job_container(self, soup: BeautifulSoup) -> Tuple[str, float]:
        """
        Detect the CSS selector for job listing containers.

        Args:
            soup: BeautifulSoup object of the page

        Returns:
            Tuple of (selector, confidence_score)
        """
        candidates = []

        # Strategy 1: Look for repeating elements with job keywords
        repeating_elements = self._find_repeating_elements(soup)
        for selector, elements in repeating_elements.items():
            if len(elements) >= 3:  # At least 3 similar elements
                score = self._score_job_containers(elements)
                candidates.append((selector, score, len(elements)))

        # Strategy 2: Look for common container patterns
        common_patterns = [
            '[class*="job"]',
            '[class*="position"]',
            '[class*="career"]',
            '[class*="opening"]',
            '[class*="listing"]',
            '[class*="vacancy"]',
            '[id*="job"]',
            '[id*="position"]',
            "[data-job]",
            "[data-position]",
            "article",
            ".card",
            ".item",
            ".row",
        ]

        for pattern in common_patterns:
            elements = soup.select(pattern)
            if len(elements) >= 3:
                score = self._score_job_containers(elements)
                if score > 0.3:
                    candidates.append((pattern, score, len(elements)))

        # Strategy 3: Look for list structures (ul, ol)
        list_items = soup.select("ul > li, ol > li")
        if len(list_items) >= 5:
            # Group by parent
            parents = defaultdict(list)
            for item in list_items:
                parent_selector = self._get_element_selector(item.parent)
                parents[parent_selector].append(item)

            for parent_selector, items in parents.items():
                if len(items) >= 3:
                    score = self._score_job_containers(items)
                    if score > 0.3:
                        candidates.append(
                            (f"{parent_selector} > li", score, len(items))
                        )

        # Sort by score and count
        candidates.sort(key=lambda x: (x[1], x[2]), reverse=True)

        if candidates and candidates[0][1] >= self.min_confidence:
            logger.info(
                f"Detected job container: {candidates[0][0]} (confidence: {candidates[0][1]:.2f})"
            )
            return candidates[0][0], candidates[0][1]
        elif candidates:
            logger.warning(
                f"Low confidence detection: {candidates[0][0]} (confidence: {candidates[0][1]:.2f})"
            )
            return candidates[0][0], candidates[0][1]

        logger.warning("Could not detect job container pattern")
        return None, 0.0

    def detect_field_selectors(
        self, container_elements: List[Tag]
    ) -> Dict[str, Tuple[str, float]]:
        """
        Detect selectors for specific fields within job containers.

        Args:
            container_elements: List of job container elements

        Returns:
            Dictionary mapping field names to (selector, confidence) tuples
        """
        if not container_elements:
            return {}

        fields = {
            "title": self._detect_title_selector(container_elements),
            "location": self._detect_location_selector(container_elements),
            "department": self._detect_department_selector(container_elements),
            "url": self._detect_url_selector(container_elements),
        }

        # Filter out low confidence detections
        return {
            field: (selector, conf)
            for field, (selector, conf) in fields.items()
            if conf >= self.min_confidence * 0.8  # Slightly lower threshold for fields
        }

    def _find_repeating_elements(self, soup: BeautifulSoup) -> Dict[str, List[Tag]]:
        """Find elements that repeat with similar structure."""
        # Group elements by their tag and class combination
        groups = defaultdict(list)

        for element in soup.find_all(True):  # Find all elements
            if element.name in ["script", "style", "meta", "link", "head"]:
                continue

            # Create a signature for this element
            classes = " ".join(sorted(element.get("class", [])))
            if classes:
                signature = f"{element.name}.{classes.replace(' ', '.')}"
            else:
                signature = element.name

            # Only consider elements with some content
            if element.get_text(strip=True):
                groups[signature].append(element)

        # Filter to groups with multiple elements
        return {k: v for k, v in groups.items() if len(v) >= 3}

    def _score_job_containers(self, elements: List[Tag]) -> float:
        """
        Score how likely these elements are job containers.

        Returns a score between 0 and 1.
        """
        if not elements:
            return 0.0

        scores = []

        for element in elements[:10]:  # Sample first 10
            score = 0.0
            text = element.get_text().lower()

            # Check for job keywords
            job_keyword_count = sum(1 for kw in self.JOB_KEYWORDS if kw in text)
            score += min(job_keyword_count * 0.15, 0.3)

            # Check for location keywords
            location_count = sum(1 for kw in self.LOCATION_KEYWORDS if kw in text)
            score += min(location_count * 0.1, 0.2)

            # Check for links (job listings usually have links)
            links = element.find_all("a")
            if links:
                score += 0.2

            # Check for headings (job titles often in headings)
            headings = element.find_all(["h1", "h2", "h3", "h4", "h5", "h6"])
            if headings:
                score += 0.15

            # Check structure (job listings usually have moderate complexity)
            child_count = len(list(element.children))
            if 2 <= child_count <= 20:
                score += 0.15

            scores.append(min(score, 1.0))

        return sum(scores) / len(scores) if scores else 0.0

    def _detect_title_selector(self, elements: List[Tag]) -> Tuple[str, float]:
        """Detect the selector for job titles."""
        candidates = Counter()

        for element in elements[:10]:
            # Strategy 1: Look for headings
            for heading in element.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
                selector = self._get_relative_selector(element, heading)
                candidates[selector] += 1

            # Strategy 2: Look for elements with 'title' in class
            for el in element.find_all(
                class_=re.compile(r".*(title|name|position|role).*", re.I)
            ):
                selector = self._get_relative_selector(element, el)
                candidates[selector] += 1

            # Strategy 3: Look for prominent text (large, bold)
            for el in element.find_all(["strong", "b"]):
                if len(el.get_text(strip=True)) > 10:
                    selector = self._get_relative_selector(element, el)
                    candidates[selector] += 0.5

        if candidates:
            most_common = candidates.most_common(1)[0]
            confidence = most_common[1] / len(elements[:10])
            return most_common[0], min(confidence, 1.0)

        return "h3, h2, .title", 0.5  # Default fallback

    def _detect_location_selector(self, elements: List[Tag]) -> Tuple[str, float]:
        """Detect the selector for location information."""
        candidates = Counter()

        for element in elements[:10]:
            text_elements = element.find_all(string=True)

            for i, text_elem in enumerate(text_elements):
                text = text_elem.strip().lower()

                # Check if this text contains location keywords
                if any(kw in text for kw in self.LOCATION_KEYWORDS):
                    parent = text_elem.parent
                    if parent:
                        selector = self._get_relative_selector(element, parent)
                        candidates[selector] += 1

            # Look for elements with location-related classes
            for el in element.find_all(
                class_=re.compile(r".*(location|city|place|office).*", re.I)
            ):
                selector = self._get_relative_selector(element, el)
                candidates[selector] += 1

        if candidates:
            most_common = candidates.most_common(1)[0]
            confidence = most_common[1] / len(elements[:10])
            return most_common[0], min(confidence, 1.0)

        return '.location, [class*="location"]', 0.4

    def _detect_department_selector(self, elements: List[Tag]) -> Tuple[str, float]:
        """Detect the selector for department/team information."""
        candidates = Counter()

        for element in elements[:10]:
            # Look for department keywords
            text_elements = element.find_all(string=True)

            for text_elem in text_elements:
                text = text_elem.strip().lower()

                if any(kw in text for kw in self.DEPARTMENT_KEYWORDS):
                    parent = text_elem.parent
                    if parent:
                        selector = self._get_relative_selector(element, parent)
                        candidates[selector] += 1

            # Look for elements with department-related classes
            for el in element.find_all(
                class_=re.compile(r".*(department|team|category|division).*", re.I)
            ):
                selector = self._get_relative_selector(element, el)
                candidates[selector] += 1

        if candidates:
            most_common = candidates.most_common(1)[0]
            confidence = most_common[1] / len(elements[:10])
            return most_common[0], min(confidence, 1.0)

        return '.department, [class*="department"]', 0.3

    def _detect_url_selector(self, elements: List[Tag]) -> Tuple[str, float]:
        """Detect the selector for job detail URLs."""
        candidates = Counter()

        for element in elements[:10]:
            # Look for the main link
            links = element.find_all("a", href=True)

            for link in links:
                # Prefer links that seem to be the main job link
                link_text = link.get_text(strip=True).lower()
                href = link.get("href", "")

                # Score based on various factors
                score = 0

                if any(kw in link_text for kw in self.JOB_KEYWORDS):
                    score += 2
                if any(kw in href.lower() for kw in self.JOB_KEYWORDS):
                    score += 2
                if len(link_text) > 15:  # Likely a job title
                    score += 1
                if link.find_parent(element) == element:  # Direct child
                    score += 1

                if score > 0:
                    selector = self._get_relative_selector(element, link)
                    candidates[selector] += score

        if candidates:
            most_common = candidates.most_common(1)[0]
            confidence = most_common[1] / (len(elements[:10]) * 3)  # Normalize
            return most_common[0], min(confidence, 1.0)

        return "a", 0.7  # Default to first link

    def _get_relative_selector(self, container: Tag, target: Tag) -> str:
        """Get a relative CSS selector from container to target."""
        if target == container:
            return ""

        # Build selector path
        path = []
        current = target

        while current and current != container and len(path) < 5:
            selector_part = current.name

            # Add class if present
            classes = current.get("class", [])
            if classes:
                # Use first meaningful class
                for cls in classes:
                    if not cls.startswith("css-") and len(cls) < 30:
                        selector_part += f".{cls}"
                        break

            path.insert(0, selector_part)
            current = current.parent

        return " ".join(path) if path else target.name

    def _get_element_selector(self, element: Tag) -> str:
        """Get a CSS selector for an element."""
        selector = element.name

        classes = element.get("class", [])
        if classes:
            selector += "." + ".".join(classes)

        elem_id = element.get("id")
        if elem_id:
            selector = f"#{elem_id}"

        return selector

    def analyze_page_structure(self, soup: BeautifulSoup) -> Dict:
        """
        Perform a complete analysis of the page structure.

        Returns:
            Dictionary with detected patterns and recommendations
        """
        result = {
            "container_selector": None,
            "container_confidence": 0.0,
            "field_selectors": {},
            "estimated_job_count": 0,
            "recommendations": [],
        }

        # Detect container
        container_selector, confidence = self.detect_job_container(soup)
        result["container_selector"] = container_selector
        result["container_confidence"] = confidence

        if container_selector:
            # Get sample containers
            containers = soup.select(container_selector)[:10]
            result["estimated_job_count"] = len(soup.select(container_selector))

            # Detect field selectors
            field_selectors = self.detect_field_selectors(containers)
            result["field_selectors"] = {
                field: selector for field, (selector, _) in field_selectors.items()
            }

            # Generate recommendations
            if confidence < 0.7:
                result["recommendations"].append(
                    "Low confidence in container detection. Manual verification recommended."
                )

            missing_fields = set(["title", "location", "url"]) - set(
                field_selectors.keys()
            )
            if missing_fields:
                result["recommendations"].append(
                    f"Could not detect selectors for: {', '.join(missing_fields)}"
                )
        else:
            result["recommendations"].append(
                "Could not automatically detect job listing pattern. Manual configuration required."
            )

        return result
