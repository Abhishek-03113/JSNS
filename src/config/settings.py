"""
Settings — Single Configuration Point.

Loads from config.yaml and environment variables.
Environment variables always override config.yaml values.
"""

import os
import logging
from dataclasses import dataclass, field
from typing import List, Optional

import yaml
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Section dataclasses
# ---------------------------------------------------------------------------


@dataclass
class DatabaseSettings:
    mongodb_uri: str
    database_name: str = "career_scraper"
    jobs_collection: str = "jobs"
    companies_collection: str = "companies"
    history_collection: str = "scrape_history"


@dataclass
class ScraperSettings:
    user_agent: str = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    timeout: int = 30
    max_retries: int = 3
    retry_delay: int = 5
    concurrent_requests: int = 5
    rate_limit_delay: float = 2.0
    min_confidence: float = 0.6
    enable_ats_strategies: bool = True


@dataclass
class LLMSettings:
    provider: str = "anthropic"
    api_key: str = ""
    model: str = "claude-sonnet-4-20250514"
    temperature: float = 0.3
    max_tokens: int = 2000


@dataclass
class EmailSettings:
    smtp_server: str = "smtp.gmail.com"
    smtp_port: int = 587
    sender_email: str = ""
    sender_password: str = ""
    recipient_emails: List[str] = field(default_factory=list)
    subject_prefix: str = "[Job Alert]"


@dataclass
class LoggingSettings:
    level: str = "INFO"
    format: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    file: str = "logs/scraper.log"


@dataclass
class Settings:
    database: DatabaseSettings
    scraper: ScraperSettings = field(default_factory=ScraperSettings)
    llm: LLMSettings = field(default_factory=LLMSettings)
    email: EmailSettings = field(default_factory=EmailSettings)
    logging: LoggingSettings = field(default_factory=LoggingSettings)


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


def _resolve_env(value: str) -> str:
    """Expand ${VAR} placeholders with environment variable values."""
    if isinstance(value, str) and value.startswith("${") and value.endswith("}"):
        env_key = value[2:-1]
        resolved = os.environ.get(env_key, "")
        if not resolved:
            logger.debug("Environment variable '%s' is not set.", env_key)
        return resolved
    return value


def _resolve_list(items: list) -> list:
    return [_resolve_env(i) for i in items]


def load_settings(config_path: str = "config.yaml") -> Settings:
    """
    Load settings from config.yaml merged with environment variables.

    Args:
        config_path: Path to the YAML configuration file.

    Returns:
        Populated Settings instance.

    Raises:
        FileNotFoundError: If config_path does not exist.
        ValueError: If required fields are missing.
    """
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Configuration file not found: {config_path}")

    with open(config_path, "r", encoding="utf-8") as fh:
        raw: dict = yaml.safe_load(fh) or {}

    # --- Database ---
    db_raw = raw.get("database", {})
    mongodb_uri = os.environ.get("MONGODB_URI") or _resolve_env(
        db_raw.get("mongodb_uri", "")
    )
    if not mongodb_uri:
        raise ValueError(
            "MONGODB_URI is required. Set it in environment or config.yaml."
        )

    database = DatabaseSettings(
        mongodb_uri=mongodb_uri,
        database_name=db_raw.get("database_name", "career_scraper"),
        jobs_collection=db_raw.get("collections", {}).get("jobs", "jobs"),
        companies_collection=db_raw.get("collections", {}).get("companies", "companies"),
        history_collection=db_raw.get("collections", {}).get("history", "scrape_history"),
    )

    # --- Scraper ---
    sc_raw = raw.get("scraper", {})
    scraper = ScraperSettings(
        user_agent=sc_raw.get("user_agent", ScraperSettings.user_agent),
        timeout=sc_raw.get("timeout", 30),
        max_retries=sc_raw.get("max_retries", 3),
        retry_delay=sc_raw.get("retry_delay", 5),
        concurrent_requests=sc_raw.get("concurrent_requests", 5),
        rate_limit_delay=float(sc_raw.get("rate_limit_delay", 2.0)),
        min_confidence=float(sc_raw.get("min_confidence", 0.6)),
        enable_ats_strategies=bool(sc_raw.get("enable_ats_strategies", True)),
    )

    # --- LLM ---
    llm_raw = raw.get("llm", {})
    llm = LLMSettings(
        provider=llm_raw.get("provider", "anthropic"),
        api_key=os.environ.get("LLM_API_KEY") or _resolve_env(llm_raw.get("api_key", "")),
        model=llm_raw.get("model", "claude-sonnet-4-20250514"),
        temperature=float(llm_raw.get("temperature", 0.3)),
        max_tokens=int(llm_raw.get("max_tokens", 2000)),
    )

    # --- Email ---
    em_raw = raw.get("email", {})
    email = EmailSettings(
        smtp_server=em_raw.get("smtp_server", "smtp.gmail.com"),
        smtp_port=int(em_raw.get("smtp_port", 587)),
        sender_email=os.environ.get("SENDER_EMAIL") or _resolve_env(em_raw.get("sender_email", "")),
        sender_password=os.environ.get("SENDER_PASSWORD") or _resolve_env(em_raw.get("sender_password", "")),
        recipient_emails=_resolve_list(em_raw.get("recipient_emails", [])),
        subject_prefix=em_raw.get("subject_prefix", "[Job Alert]"),
    )

    # --- Logging ---
    log_raw = raw.get("logging", {})
    logging_settings = LoggingSettings(
        level=log_raw.get("level", "INFO"),
        format=log_raw.get("format", "%(asctime)s - %(name)s - %(levelname)s - %(message)s"),
        file=log_raw.get("file", "logs/scraper.log"),
    )

    return Settings(
        database=database,
        scraper=scraper,
        llm=llm,
        email=email,
        logging=logging_settings,
    )
