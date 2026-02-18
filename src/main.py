"""
Main entry point for ATS-Buddy Career Scraper.

Flow:
  1. Load config
  2. Set up logging
  3. Connect to MongoDB
  4. Load resume (.tex → plain text)
  5. Scrape all career pages
  6. Retrieve new jobs since last run
  7. If LLM enabled and resume provided → analyse each new job
  8. Send email notification if new jobs found
  9. Persist scrape history & disconnect

CLI flags:
  --config       Path to config.yaml      (default: config.yaml)
  --resume       Path to resume .tex file  (default: data/resume.tex)
  --urls         Path to URL list file     (default: data/career_pages.txt)
  --dry-run      Print jobs, skip emails
  --skip-llm     Skip resume analysis
  --test-email   Send test email without scraping
  --verbose      Enable DEBUG logging
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from typing import List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Resume extraction (reused from root parser.py)
# ---------------------------------------------------------------------------


def extract_resume_text(resume_path: str) -> str:
    """
    Convert a LaTeX resume file to plain text.

    Uses pylatexenc when available, otherwise falls back to the
    custom section parser from parser.py at the project root.

    Args:
        resume_path: Path to the .tex file.

    Returns:
        Plain-text representation of the resume.
    """
    if not os.path.exists(resume_path):
        logger.warning("Resume file not found: %s", resume_path)
        return ""

    # ---- Try pylatexenc (clean conversion) ----
    try:
        from pylatexenc.latex2text import LatexNodes2Text  # type: ignore
        with open(resume_path, "r", encoding="utf-8") as fh:
            latex = fh.read()
        return LatexNodes2Text().latex_to_text(latex)
    except ImportError:
        pass

    # ---- Fallback: strip LaTeX commands naively ----
    logger.debug("pylatexenc not installed — using naive LaTeX stripper")
    import re
    with open(resume_path, "r", encoding="utf-8") as fh:
        text = fh.read()
    text = re.sub(r"\\[a-zA-Z]+\*?(\{[^}]*\}|\[[^\]]*\])*", " ", text)
    text = re.sub(r"[{}]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ATS-Buddy — automated job scraper with LLM resume matching"
    )
    parser.add_argument("--config",      default="config.yaml",         help="Path to config.yaml")
    parser.add_argument("--resume",      default="data/resume.tex",     help="Path to resume .tex file")
    parser.add_argument("--urls",        default="data/career_pages.txt", help="Path to URL list file")
    parser.add_argument("--dry-run",     action="store_true",           help="Skip email, print results")
    parser.add_argument("--skip-llm",   action="store_true",           help="Skip LLM resume analysis")
    parser.add_argument("--test-email", action="store_true",            help="Send test email, skip scraping")
    parser.add_argument("--verbose",    action="store_true",            help="Enable DEBUG logging")
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    args = _parse_args()

    # ---- Imports (deferred so --help is always fast) ----
    from src.config.settings import load_settings
    from src.utils.logger import setup_logger
    from src.utils.helpers import read_url_list
    from src.database.mongodb_client import MongoDBClient
    from src.scraper.career_page_scraper import CareerPageScraper
    from src.llm.resume_analyzer import ResumeAnalyzer
    from src.notification.email_service import EmailService

    # ---- Config & logging ----
    try:
        settings = load_settings(args.config)
    except (FileNotFoundError, ValueError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1

    setup_logger(
        level="DEBUG" if args.verbose else settings.logging.level,
        fmt=settings.logging.format,
        log_file=settings.logging.file,
    )

    logger.info("=== ATS-Buddy starting ===")

    # ---- MongoDB ----
    db = MongoDBClient(
        connection_string=settings.database.mongodb_uri,
        database_name=settings.database.database_name,
        jobs_collection=settings.database.jobs_collection,
        companies_collection=settings.database.companies_collection,
        history_collection=settings.database.history_collection,
    )

    try:
        db.connect()
    except Exception as exc:
        logger.error("Cannot connect to MongoDB: %s", exc)
        return 1

    try:
        # ---- Test email mode ----
        if args.test_email:
            email_svc = EmailService(settings.email)
            ok = email_svc.test_connection()
            logger.info("Test email connection: %s", "OK" if ok else "FAILED")
            return 0 if ok else 1

        # ---- Load URLs ----
        if not os.path.exists(args.urls):
            logger.error("URL list not found: %s", args.urls)
            return 1

        urls: List[str] = read_url_list(args.urls)
        if not urls:
            logger.warning("URL list is empty — nothing to scrape.")
            return 0

        logger.info("Loaded %d URLs to scrape", len(urls))

        # ---- Scrape ----
        scraper = CareerPageScraper(db, settings.scraper)
        report = scraper.scrape_all(urls)

        if report["new_jobs"] == 0:
            logger.info("No new jobs found — skipping LLM analysis and email.")
            return 0

        # ---- Load new jobs ----
        new_jobs = db.get_new_jobs()
        logger.info("%d new job(s) to process", len(new_jobs))

        # ---- LLM analysis ----
        analyses = []
        if not args.skip_llm and settings.llm.api_key:
            resume_text = extract_resume_text(args.resume)
            if resume_text:
                analyzer = ResumeAnalyzer(settings.llm)
                analyses = analyzer.batch_analyze(resume_text, new_jobs)
                # Persist analyses
                for analysis in analyses:
                    db.insert_resume_analysis(analysis)
                logger.info("LLM analysis complete for %d jobs", len(analyses))
            else:
                logger.warning("Resume text is empty — skipping LLM analysis")
        else:
            logger.info("LLM analysis skipped (--skip-llm or no API key)")

        # ---- Email ----
        if args.dry_run:
            logger.info("[dry-run] Would send email for %d jobs:", len(new_jobs))
            for job in new_jobs:
                logger.info("  • %s — %s (%s)", job.company, job.title, job.url)
        else:
            email_svc = EmailService(settings.email)
            sent = email_svc.send_job_alert(
                new_jobs=new_jobs,
                analyses=analyses if analyses else None,
                urls_scraped=report["urls_succeeded"],
            )
            if sent:
                logger.info("Job alert email sent successfully.")
                # Mark jobs as seen after successful notification
                db.mark_jobs_as_seen([j.id for j in new_jobs])
            else:
                logger.warning("Email sending failed — jobs remain marked as new.")

        logger.info("=== ATS-Buddy finished ===")
        return 0

    finally:
        db.disconnect()


if __name__ == "__main__":
    sys.exit(main())
