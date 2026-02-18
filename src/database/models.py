"""
Data Models.

Pydantic v2 models used for validation across the whole application.
These are pure data bags — no business logic, no I/O.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, HttpUrl


# ---------------------------------------------------------------------------
# Job
# ---------------------------------------------------------------------------


class Job(BaseModel):
    """Represents a single job listing."""

    id: str = Field(..., description="Stable 16-char hex ID derived from company+title+url")
    company: str
    title: str
    location: str = ""
    department: str = ""
    experience: str = ""
    description: str = ""
    url: str = ""
    posted_date: Optional[datetime] = None
    scraped_date: datetime = Field(default_factory=datetime.utcnow)
    is_new: bool = True
    ats_type: str = "unknown"   # greenhouse | lever | workday | universal | unknown

    model_config = {"populate_by_name": True}

    def to_mongo(self) -> Dict[str, Any]:
        """Return a dict suitable for MongoDB insertion (uses str for _id)."""
        data = self.model_dump()
        data["_id"] = data.pop("id")
        return data

    @classmethod
    def from_mongo(cls, doc: Dict[str, Any]) -> "Job":
        """Rebuild from a MongoDB document."""
        doc = dict(doc)
        if "_id" in doc:
            doc["id"] = doc.pop("_id")
        return cls(**doc)


# ---------------------------------------------------------------------------
# Company
# ---------------------------------------------------------------------------


class Company(BaseModel):
    """Represents a company whose career page is being tracked."""

    name: str
    career_page_url: str
    last_scraped: Optional[datetime] = None
    total_jobs: int = 0
    ats_type: str = "unknown"

    def to_mongo(self) -> Dict[str, Any]:
        return self.model_dump()

    @classmethod
    def from_mongo(cls, doc: Dict[str, Any]) -> "Company":
        doc = dict(doc)
        doc.pop("_id", None)
        return cls(**doc)


# ---------------------------------------------------------------------------
# ScrapeHistory
# ---------------------------------------------------------------------------


class ScrapeHistory(BaseModel):
    """Metadata for a single scrape run."""

    scrape_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    companies_scraped: int = 0
    jobs_found: int = 0
    new_jobs: int = 0
    errors: List[str] = Field(default_factory=list)
    duration_seconds: float = 0.0

    def to_mongo(self) -> Dict[str, Any]:
        data = self.model_dump()
        data["_id"] = data.pop("scrape_id")
        return data


# ---------------------------------------------------------------------------
# ResumeAnalysis
# ---------------------------------------------------------------------------


class ResumeAnalysis(BaseModel):
    """LLM analysis result for a single job vs. resume."""

    job_id: str
    resume_score: float = Field(ge=0.0, le=100.0)
    strong_matches: List[str] = Field(default_factory=list)
    missing_skills: List[str] = Field(default_factory=list)
    keyword_matches: Dict[str, int] = Field(default_factory=dict)
    recommendations: str = ""

    def to_mongo(self) -> Dict[str, Any]:
        return self.model_dump()
