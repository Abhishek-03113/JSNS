"""
Centralized Logging Configuration.

Call setup_logger() once at application startup (in main.py).
All other modules should simply use: logger = logging.getLogger(__name__)
"""

import logging
import logging.handlers
import os
import sys
from typing import Optional


def setup_logger(
    level: str = "INFO",
    fmt: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    log_file: Optional[str] = None,
) -> None:
    """
    Configure the root logger with console + optional rotating-file handler.

    Args:
        level: Log level string (DEBUG, INFO, WARNING, ERROR, CRITICAL).
        fmt: Log record format string.
        log_file: Path to log file. If None, file logging is skipped.
    """
    numeric_level = getattr(logging, level.upper(), logging.INFO)

    formatter = logging.Formatter(fmt)

    handlers: list[logging.Handler] = []

    # --- Console handler (stdout) ---
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    handlers.append(console_handler)

    # --- File handler (rotating) ---
    if log_file:
        log_dir = os.path.dirname(log_file)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=5,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        handlers.append(file_handler)

    logging.basicConfig(level=numeric_level, handlers=handlers, force=True)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("pymongo").setLevel(logging.WARNING)
