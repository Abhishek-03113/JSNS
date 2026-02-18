"""
MongoDB Client.

All database I/O is encapsulated here. The rest of the codebase only
sees typed model objects — never raw pymongo dicts.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import List, Optional

import pymongo
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, OperationFailure

from src.database.models import Company, Job, ResumeAnalysis, ScrapeHistory

logger = logging.getLogger(__name__)


class MongoDBClient:
    """Thin wrapper around pymongo for all career-scraper operations."""

    def __init__(
        self,
        connection_string: str,
        database_name: str = "career_scraper",
        jobs_collection: str = "jobs",
        companies_collection: str = "companies",
        history_collection: str = "scrape_history",
    ) -> None:
        self._connection_string = connection_string
        self._database_name = database_name
        self._col_jobs = jobs_collection
        self._col_companies = companies_collection
        self._col_history = history_collection

        self._client: Optional[MongoClient] = None
        self._db = None

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    def connect(self) -> None:
        """Establish the MongoDB connection and ensure indexes exist."""
        logger.info("Connecting to MongoDB…")
        self._client = MongoClient(
            self._connection_string,
            serverSelectionTimeoutMS=10_000,
            connectTimeoutMS=10_000,
        )
        self._db = self._client[self._database_name]
        self.health_check()
        self._create_indexes()
        logger.info("MongoDB connected — database: %s", self._database_name)

    def disconnect(self) -> None:
        """Close the MongoDB connection gracefully."""
        if self._client:
            self._client.close()
            self._client = None
            logger.info("MongoDB connection closed.")

    def health_check(self) -> bool:
        """Verify connectivity; raises ConnectionFailure on failure."""
        try:
            self._client.admin.command("ping")
            return True
        except (ConnectionFailure, OperationFailure) as exc:
            logger.error("MongoDB health-check failed: %s", exc)
            raise

    def _create_indexes(self) -> None:
        """Create compound indexes for efficient queries."""
        jobs_col = self._db[self._col_jobs]
        jobs_col.create_index([("company", pymongo.ASCENDING), ("is_new", pymongo.DESCENDING)])
        jobs_col.create_index([("scraped_date", pymongo.DESCENDING)])
        jobs_col.create_index([("_id", pymongo.ASCENDING)], unique=True)

        companies_col = self._db[self._col_companies]
        companies_col.create_index([("career_page_url", pymongo.ASCENDING)], unique=True)

    # ------------------------------------------------------------------
    # Job operations
    # ------------------------------------------------------------------

    def insert_job(self, job: Job) -> str:
        """
        Insert a new job document.

        Args:
            job: Job model instance.

        Returns:
            The inserted document ID.
        """
        doc = job.to_mongo()
        result = self._db[self._col_jobs].insert_one(doc)
        logger.debug("Inserted job: %s - %s", job.company, job.title)
        return str(result.inserted_id)

    def upsert_job(self, job: Job) -> bool:
        """
        Insert or update a job document.

        Returns:
            True if a new document was inserted, False if updated.
        """
        doc = job.to_mongo()
        result = self._db[self._col_jobs].replace_one(
            {"_id": doc["_id"]}, doc, upsert=True
        )
        is_new = result.upserted_id is not None
        logger.debug("%s job: %s - %s", "Inserted" if is_new else "Updated", job.company, job.title)
        return is_new

    def get_job_by_id(self, job_id: str) -> Optional[Job]:
        """Retrieve a Job by its ID."""
        doc = self._db[self._col_jobs].find_one({"_id": job_id})
        return Job.from_mongo(doc) if doc else None

    def get_jobs_by_company(self, company: str) -> List[Job]:
        """Return all jobs for a given company."""
        cursor = self._db[self._col_jobs].find({"company": company})
        return [Job.from_mongo(d) for d in cursor]

    def get_new_jobs(self, since: Optional[datetime] = None) -> List[Job]:
        """
        Retrieve jobs marked as new.

        Args:
            since: If provided, only return jobs scraped after this datetime.

        Returns:
            List of Job instances.
        """
        query: dict = {"is_new": True}
        if since:
            query["scraped_date"] = {"$gte": since}
        cursor = self._db[self._col_jobs].find(query).sort("scraped_date", pymongo.DESCENDING)
        return [Job.from_mongo(d) for d in cursor]

    def mark_jobs_as_seen(self, job_ids: List[str]) -> int:
        """
        Mark jobs as no longer new.

        Returns:
            Number of documents modified.
        """
        result = self._db[self._col_jobs].update_many(
            {"_id": {"$in": job_ids}}, {"$set": {"is_new": False}}
        )
        return result.modified_count

    def job_exists(self, job_id: str) -> bool:
        """Return True if a job with *job_id* already exists."""
        return self._db[self._col_jobs].count_documents({"_id": job_id}, limit=1) > 0

    # ------------------------------------------------------------------
    # Company operations
    # ------------------------------------------------------------------

    def upsert_company(self, company: Company) -> None:
        """Insert or update company metadata."""
        doc = company.to_mongo()
        self._db[self._col_companies].replace_one(
            {"career_page_url": company.career_page_url}, doc, upsert=True
        )

    # ------------------------------------------------------------------
    # Scrape history
    # ------------------------------------------------------------------

    def insert_scrape_history(self, history: ScrapeHistory) -> None:
        """Persist a scrape run record."""
        self._db[self._col_history].insert_one(history.to_mongo())

    def get_last_scrape_time(self) -> Optional[datetime]:
        """Return the timestamp of the most recent successful scrape, or None."""
        doc = (
            self._db[self._col_history]
            .find()
            .sort("timestamp", pymongo.DESCENDING)
            .limit(1)
        )
        for d in doc:
            return d.get("timestamp")
        return None

    # ------------------------------------------------------------------
    # Resume analysis
    # ------------------------------------------------------------------

    def insert_resume_analysis(self, analysis: ResumeAnalysis) -> None:
        """Persist a resume analysis result."""
        self._db["resume_analyses"].replace_one(
            {"job_id": analysis.job_id}, analysis.to_mongo(), upsert=True
        )
