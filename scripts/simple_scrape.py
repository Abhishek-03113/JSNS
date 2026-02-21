#!/usr/bin/env python3
"""
Lightweight scraper for testing: reads data/career_pages.txt,
fetches each URL and reports counts of job-like links.

This avoids requiring project dependencies or DB access.
"""
from __future__ import annotations

import re
import ssl
import sys
from pathlib import Path
from typing import List

try:
    from urllib.request import Request, urlopen
except Exception:
    print("urllib not available", file=sys.stderr)
    raise


URLS_FILE = Path("data/career_pages.txt")


def read_url_list(path: Path) -> List[str]:
    if not path.exists():
        raise FileNotFoundError(path)
    urls: List[str] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            urls.append(line)
    return urls


def fetch(url: str) -> str:
    req = Request(url, headers={"User-Agent": "ATS-Buddy-Test/1.0"})
    # allow https sites with default context
    ctx = ssl.create_default_context()
    with urlopen(req, context=ctx, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def find_job_links(html: str) -> List[str]:
    # crude heuristic: hrefs containing 'job' or '/jobs' or '/careers/'
    hrefs = re.findall(r'href=["\']([^"\']+)["\']', html, flags=re.I)
    jobs = [h for h in hrefs if re.search(r"\b(job|jobs|careers?)\b", h, flags=re.I)]
    return jobs


def main() -> int:
    try:
        urls = read_url_list(URLS_FILE)
    except FileNotFoundError:
        print(f"URL list not found: {URLS_FILE}")
        return 1

    if not urls:
        print("No URLs to scrape.")
        return 0

    print(f"Scraping {len(urls)} URL(s) from {URLS_FILE}")
    for url in urls:
        print(f"\n--- {url} ---")
        try:
            html = fetch(url)
            jobs = find_job_links(html)
            print(f"Fetched {len(html)} chars; found {len(jobs)} job-like links")
            if jobs:
                for j in jobs[:10]:
                    print(f"  - {j}")
        except Exception as exc:
            print(f"Failed to fetch {url}: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
