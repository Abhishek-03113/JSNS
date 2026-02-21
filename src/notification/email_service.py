"""
Email Notification Service.

Renders Jinja2 HTML/text templates and sends via Gmail SMTP.
Uses multipart/alternative so clients get HTML with a plain-text fallback.
"""

from __future__ import annotations

import logging
import os
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

from jinja2 import Environment, FileSystemLoader

from src.config.settings import EmailSettings
from src.database.models import Job, ResumeAnalysis

logger = logging.getLogger(__name__)

_TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "templates")


class EmailService:
    """
    Renders and sends job-alert emails.

    Designed to be plug-and-play:
    - Swap out the SMTP provider by subclassing and overriding _send_raw().
    - Swap out templates by replacing files in templates/.
    """

    def __init__(self, settings: EmailSettings) -> None:
        self._settings = settings
        self._jinja = Environment(
            loader=FileSystemLoader(_TEMPLATE_DIR),
            autoescape=True,
            trim_blocks=True,
            lstrip_blocks=True,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def send_job_alert(
        self,
        new_jobs: List[Job],
        analyses: Optional[List[ResumeAnalysis]] = None,
        urls_scraped: int = 0,
    ) -> bool:
        """
        Render and send a job-alert email.

        Args:
            new_jobs:     List of new Job objects to include.
            analyses:     Parallel list of ResumeAnalysis objects (or None).
            urls_scraped: Number of career pages scraped (for summary line).

        Returns:
            True if email was sent successfully, False otherwise.
        """
        if not new_jobs:
            logger.info("No new jobs — skipping email.")
            return False

        # Pair each job with its analysis (or None)
        analysis_map: Dict[str, ResumeAnalysis] = {}
        if analyses:
            analysis_map = {a.job_id: a for a in analyses}

        items = [{"job": job, "analysis": analysis_map.get(job.id)} for job in new_jobs]

        context = {
            "subject": f"{self._settings.subject_prefix} {len(new_jobs)} New Job(s) Found",
            "generated_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
            "new_jobs": items,
            "urls_scraped": urls_scraped,
        }

        html_body = self._render("email_template.html", context)
        text_body = self._render("email_template.txt", context)

        return self._send_to_all(context["subject"], html_body, text_body)

    def test_connection(self) -> bool:
        """
        Verify SMTP credentials by opening and immediately closing a connection.

        Returns:
            True if connection succeeds, False otherwise.
        """
        try:
            with smtplib.SMTP(
                self._settings.smtp_server, self._settings.smtp_port
            ) as server:
                server.ehlo()
                server.starttls()
                server.login(
                    self._settings.sender_email, self._settings.sender_password
                )
            logger.info("SMTP connection test successful.")
            return True
        except Exception as exc:
            logger.error("SMTP connection test failed: %s", exc)
            return False

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _render(self, template_name: str, context: Dict[str, Any]) -> str:
        tmpl = self._jinja.get_template(template_name)
        return tmpl.render(**context)

    def _send_to_all(self, subject: str, html_body: str, text_body: str) -> bool:
        # If no recipients are configured, fail early and log an error so
        # callers (like send_job_alert) can react accordingly.
        if not self._settings.recipient_emails:
            logger.error("No recipient emails configured; aborting email send.")
            return False

        success = True
        for recipient in self._settings.recipient_emails:
            if not recipient:
                continue
            try:
                self._send_raw(recipient, subject, html_body, text_body)
                logger.info("Email sent to %s", recipient)
            except Exception as exc:
                logger.error("Failed to send email to %s: %s", recipient, exc)
                success = False
        return success

    def _send_raw(
        self,
        recipient: str,
        subject: str,
        html_body: str,
        text_body: str,
    ) -> None:
        """
        Send one multipart email via Gmail SMTP with TLS.

        Override this method to use a different provider (SendGrid, Mailgun, etc.).
        """
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = self._settings.sender_email
        msg["To"] = recipient

        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        with smtplib.SMTP(
            self._settings.smtp_server, self._settings.smtp_port
        ) as server:
            server.ehlo()
            server.starttls()
            server.login(self._settings.sender_email, self._settings.sender_password)
            server.sendmail(self._settings.sender_email, recipient, msg.as_string())
