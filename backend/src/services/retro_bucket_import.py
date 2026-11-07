"""Import case folders that were copied into the staging area of the storage bucket (incoming/...).

Nothing is fetched from another organisation here and no outside keys are used: the files are already in our
own bucket. Each case goes through exactly the same checks as an uploaded one (evaluate_case + record_case), and
passing cases are stored under retrospective/case_xxxxx/ like any other case.
"""
import datetime
import logging
import os
import shutil
from pathlib import Path
from typing import Dict, List

from ..core.config import settings
from ..models.retro import RetroBatch
from . import retro_intake as intake

logger = logging.getLogger(__name__)


def import_bucket() -> str:
    return os.environ.get("RETRO_IMPORT_BUCKET") or settings.GCP_STORAGE_BUCKET


def import_root() -> str:
    return os.environ.get("RETRO_IMPORT_PREFIX", "incoming/").strip("/") + "/"


def clean_folder(folder: str) -> str:
    """'th-bcd/MAMMO_50' -> 'incoming/th-bcd/MAMMO_50/'. Anything that could climb out of incoming/ is refused."""
    parts = [p for p in folder.replace("\\\\", "/").split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        raise ValueError("Invalid folder")
    return import_root() + "/".join(parts) + "/"


def list_folders() -> List[dict]:
    """Folders waiting in incoming/, one row per <supplier>/<folder> with object count and size."""
    root = import_root()
    found: Dict[str, dict] = {}
    for blob in intake._bucket(import_bucket()).client.list_blobs(import_bucket(), prefix=root):
        if blob.name.endswith("/"):
            continue
        parts = blob.name[len(root):].split("/")
        key = "/".join(parts[:2]) if len(parts) > 2 else parts[0]
        row = found.setdefault(key, {"folder": key, "objects": 0, "bytes": 0})
        row["objects"] += 1
        row["bytes"] += blob.size or 0
    return sorted(found.values(), key=lambda r: r["folder"])


def import_folder(batch_id: int, folder: str, session_factory):
    """Background job: check and store every case under incoming/<folder>/. Safe to run again: stored cases are skipped."""
    db = session_factory()
    work = intake.staging_root() / str(batch_id)
    try:
        prefix = clean_folder(folder)
        bucket = intake._bucket(import_bucket())
        batch = db.query(RetroBatch).get(batch_id)
        batch.qc_status, batch.qc_phase = "processing", "Listing files"
        db.commit()
        intake.touch_heartbeat(batch_id)

        # Empty placeholder files with the same names let the normal case discovery work without downloading anything yet.
        skeleton, blobs = work / "skeleton", {}
        for blob in bucket.client.list_blobs(import_bucket(), prefix=prefix):
            rel = blob.name[len(prefix):]
            if not rel or rel.endswith("/"):
                continue
            target = skeleton / intake_safe(rel)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.touch()
            blobs[target.relative_to(skeleton).as_posix()] = blob
        batch.qc_files_received, batch.qc_bytes_received = len(blobs), sum(b.size or 0 for b in blobs.values())
        cases = intake.discover_cases(skeleton) if blobs else []
        batch.qc_total_cases, batch.qc_phase = len(cases), "Running checks"
        db.commit()

        known = 0
        for name, placeholder in cases:
            intake.touch_heartbeat(batch_id)
            batch.qc_phase = f"Reading {name}"
            db.commit()
            real = work / "case"
            shutil.rmtree(real, ignore_errors=True)
            for p in placeholder.rglob("*"):
                if p.is_file():
                    target = real / p.relative_to(placeholder)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    blobs[p.relative_to(skeleton).as_posix()].download_to_filename(str(target))
                    intake.touch_heartbeat(batch_id)
            known += intake.record_case(db, batch, name, intake.evaluate_case(real, name), skip_known=True) == "known"
            shutil.rmtree(real, ignore_errors=True)

        batch.qc_status = "completed"
        batch.qc_phase = "Done" + (f" · {known} already stored, skipped" if known else "")
        batch.qc_finished_at = datetime.datetime.utcnow()
        db.commit()
    except Exception as exc:
        logger.exception("Bucket import %s failed", batch_id)
        db.rollback()
        batch = db.query(RetroBatch).get(batch_id)
        if batch:
            batch.qc_status, batch.qc_phase = "failed", "Failed"
            batch.qc_error = f"{type(exc).__name__}: {exc}"[:1000]
            batch.qc_finished_at = datetime.datetime.utcnow()
            db.commit()
    finally:
        shutil.rmtree(work, ignore_errors=True)
        db.close()


def intake_safe(rel: str) -> Path:
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        raise ValueError(f"Unsafe object name: {rel}")
    return Path(*parts)
