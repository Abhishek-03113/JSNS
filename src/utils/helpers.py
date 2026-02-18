"""
Utility Helper Functions.

Pure, side-effect-free helpers used across the project.
"""

import hashlib
import logging
import re
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# URL utilities
# ---------------------------------------------------------------------------


def extract_domain(url: str) -> str:
    """Return the netloc of a URL (e.g. 'jobs.greenhouse.io')."""
    try:
        return urlparse(url).netloc
    except Exception:
        return ""


def is_valid_url(url: str) -> bool:
    """Return True if *url* has a valid http/https scheme and netloc."""
    try:
        result = urlparse(url)
        return result.scheme in ("http", "https") and bool(result.netloc)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Text utilities
# ---------------------------------------------------------------------------


def sanitize_filename(text: str) -> str:
    """Replace non-alphanumeric characters with underscores."""
    return re.sub(r"[^\w\-]", "_", text).strip("_")


def truncate_text(text: str, max_length: int = 500) -> str:
    """Truncate *text* to *max_length* characters, appending '…' if trimmed."""
    if not text:
        return ""
    text = text.strip()
    if len(text) <= max_length:
        return text
    return text[:max_length - 1] + "…"


def clean_whitespace(text: str) -> str:
    """Collapse consecutive whitespace and strip surrounding space."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


# ---------------------------------------------------------------------------
# Date utilities
# ---------------------------------------------------------------------------

_DATE_PATTERNS = [
    "%Y-%m-%d",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%SZ",
    "%B %d, %Y",
    "%b %d, %Y",
    "%d %B %Y",
    "%d/%m/%Y",
    "%m/%d/%Y",
]


def parse_date(date_string: Optional[str]) -> Optional[datetime]:
    """
    Try common date formats and return a datetime, or None if unparseable.

    Args:
        date_string: String representation of a date.

    Returns:
        datetime object or None.
    """
    if not date_string:
        return None
    date_string = date_string.strip()
    for fmt in _DATE_PATTERNS:
        try:
            return datetime.strptime(date_string, fmt)
        except ValueError:
            continue
    logger.debug("Could not parse date string: '%s'", date_string)
    return None


# ---------------------------------------------------------------------------
# Job ID generation
# ---------------------------------------------------------------------------


def generate_job_id(company: str, title: str, url: str) -> str:
    """
    Generate a stable, unique job identifier from company + title + URL.

    Args:
        company: Company name.
        title: Job title.
        url: Job application URL.

    Returns:
        A 16-character hex digest string.
    """
    raw = f"{company.lower().strip()}|{title.lower().strip()}|{url.strip()}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:16]  # noqa: S324


# ---------------------------------------------------------------------------
# File utilities
# ---------------------------------------------------------------------------


def read_text_file(path: str, encoding: str = "utf-8") -> str:
    """Read *path* and return its contents as a string."""
    with open(path, "r", encoding=encoding) as fh:
        return fh.read()


def read_url_list(path: str) -> list[str]:
    """
    Read a plain-text file of URLs, one per line.
    Lines starting with '#' and blank lines are ignored.

    Args:
        path: Path to the URL list file.

    Returns:
        List of valid URL strings.
    """
    urls = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                if is_valid_url(line):
                    urls.append(line)
                else:
                    logger.warning("Skipping invalid URL: %s", line)
    return urls


# ---------------------------------------------------------------------------
# Similarity
# ---------------------------------------------------------------------------


def calculate_similarity(text1: str, text2: str) -> float:
    """
    Compute a simple Jaccard similarity between two text strings.

    Returns a float in [0, 1].
    """
    if not text1 or not text2:
        return 0.0
    words1 = set(re.findall(r"\w+", text1.lower()))
    words2 = set(re.findall(r"\w+", text2.lower()))
    if not words1 or not words2:
        return 0.0
    intersection = words1 & words2
    union = words1 | words2
    return len(intersection) / len(union)
