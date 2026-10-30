"""Prospective data for the portal, read from the master CSV pair (see the master CSV specification).

The portal never queries the live clinical databases for this: a build script writes
prospective_master.csv and prospective_files.csv, and this module reads the latest pair
from GCS (or a local folder while developing) and answers filter / count / detail questions.
"""
import csv
import io
import os
import threading
import time
from collections import Counter, defaultdict
from typing import Dict, List

CACHE_SECONDS = 60
_lock = threading.Lock()
_cache: dict = {"at": 0.0, "key": None, "data": None}


class NotConfigured(Exception):
    pass


def _uris():
    master = os.environ.get("PROSPECTIVE_MASTER_URI", "").strip()
    files = os.environ.get("PROSPECTIVE_FILES_URI", "").strip()
    if not master and os.environ.get("PROSPECTIVE_DIR"):
        base = os.environ["PROSPECTIVE_DIR"].rstrip("/")
        master, files = f"{base}/prospective_master.csv", f"{base}/prospective_files.csv"
    return master, files


def _read(uri: str) -> str:
    if uri.startswith("gs://"):
        from . import retro_intake as intake
        return intake.read_from_gcs(uri).decode("utf-8-sig")
    with open(uri.replace("file://", ""), "r", encoding="utf-8-sig", newline="") as f:
        return f.read()


def technology(row: dict) -> str:
    """CR / DR from the hospital's machine technology (a hospital with both would need a per-session value)."""
    t = (row.get("mammo_technology") or "").lower().strip()
    if t == "cr" or t.startswith("cr ") or "computed" in t:
        return "CR"
    if t == "dr" or t.startswith("dr ") or "digital" in t or "direct" in t:
        return "DR"
    return "Unknown"


def load(force: bool = False) -> dict:
    master_uri, files_uri = _uris()
    if not master_uri:
        raise NotConfigured("PROSPECTIVE_MASTER_URI is not set")
    key = (master_uri, files_uri)
    with _lock:
        if not force and _cache["data"] and _cache["key"] == key and time.time() - _cache["at"] < CACHE_SECONDS:
            return _cache["data"]
        rows = list(csv.DictReader(io.StringIO(_read(master_uri))))
        files = list(csv.DictReader(io.StringIO(_read(files_uri)))) if files_uri else []
        for r in rows:
            r["_tech"] = technology(r)
        by_session: Dict[str, List[dict]] = defaultdict(list)
        for f in files:
            by_session[f["session_id"]].append(f)
        data = {"rows": rows, "files": by_session, "by_id": {r["session_id"]: r for r in rows},
                "built_at": rows[0].get("master_built_at") if rows else None,
                "version": rows[0].get("master_build_version") if rows else None,
                "uri": master_uri, "n_files": len(files)}
        _cache.update(at=time.time(), key=key, data=data)
        return data


def reset_cache():
    with _lock:
        _cache.update(at=0.0, key=None, data=None)


def flag(row: dict, col: str) -> bool:
    return str(row.get(col, "")).strip() == "1"


def filter_rows(rows: List[dict], q: str = "", source: str = "", hospital_id: str = "", tech: str = "", birads: str = "",
                density: str = "", complete: bool = False, latest_only: bool = False, include_test: bool = False,
                assessed: bool = False, quarter: str = "") -> List[dict]:
    q = q.strip().lower()
    out = []
    for r in rows:
        if not include_test and flag(r, "is_test"):
            continue
        if source and r.get("data_source") != source:
            continue
        if hospital_id and r.get("hospital_id") != hospital_id:
            continue
        if tech and r["_tech"] != tech:
            continue
        if birads and str(r.get("birads_max", "")) != birads:
            continue
        if density and r.get("density_max") != density:
            continue
        if complete and not flag(r, "is_complete_datapoint"):
            continue
        if latest_only and not flag(r, "is_latest_session_for_subject"):
            continue
        if assessed and not flag(r, "has_assessment"):
            continue
        if quarter and r.get("enrolment_quarter") != quarter:
            continue
        if q and q not in " ".join(str(r.get(c, "")) for c in ("session_id", "subject_id", "hospital_name", "hospital_short_name")).lower():
            continue
        out.append(r)
    return out


def _count(rows, col):
    return dict(Counter(r.get(col) or "–" for r in rows))


def stats(rows: List[dict]) -> dict:
    return {
        "sessions": len(rows),
        "pilot": sum(r.get("data_source") == "pilot" for r in rows),
        "portal": sum(r.get("data_source") == "portal" for r in rows),
        "assessed": sum(flag(r, "has_assessment") for r in rows),
        "four_views": sum(flag(r, "has_all_4_views") for r in rows),
        "complete": sum(flag(r, "is_complete_datapoint") for r in rows),
        "cr": sum(r["_tech"] == "CR" for r in rows),
        "dr": sum(r["_tech"] == "DR" for r in rows),
        "high_risk": sum(flag(r, "outcome_high_risk") for r in rows),
    }


def hospitals(rows: List[dict]) -> List[dict]:
    groups: Dict[str, List[dict]] = defaultdict(list)
    for r in rows:
        groups[r["hospital_id"]].append(r)
    out = []
    for hid, rs in groups.items():
        first = rs[0]
        out.append({"hospital_id": hid, "name": first.get("hospital_name"), "short_name": first.get("hospital_short_name"),
                    "state": first.get("hospital_state"), "type": first.get("hospital_type"), "technology": first["_tech"],
                    "make": first.get("mammo_make"), "machine": first.get("mammo_machine"),
                    "last_session": max((r.get("session_start_at") or "" for r in rs), default=""), **stats(rs)})
    return sorted(out, key=lambda h: (-h["sessions"], h["hospital_id"]))


def summary(rows: List[dict]) -> dict:
    """Everything the dashboard needs, test rows already excluded by the caller."""
    funnel_keys = [("Sessions", lambda r: True), ("Consent or pilot", lambda r: flag(r, "has_consent") or flag(r, "consent_not_captured_by_design")),
                   ("Clinician assessment", lambda r: flag(r, "has_assessment")), ("All 4 views", lambda r: flag(r, "has_all_4_views")),
                   ("Complete datapoint", lambda r: flag(r, "is_complete_datapoint"))]
    assessed = [r for r in rows if flag(r, "has_assessment")]
    return {
        **stats(rows), "hospitals": len({r["hospital_id"] for r in rows}),
        "by_month": dict(sorted(Counter(r.get("enrolment_month") for r in rows if r.get("enrolment_month")).items())),
        "by_technology": dict(Counter(r["_tech"] for r in rows)),
        "by_birads": dict(sorted(Counter(str(r.get("birads_max")) for r in assessed if r.get("birads_max") != "").items())),
        "by_density": dict(sorted(Counter(r.get("density_max") for r in assessed if r.get("density_max")).items())),
        "by_state": _count(rows, "hospital_state"),
        "funnel": [{"label": k, "value": sum(1 for r in rows if fn(r))} for k, fn in funnel_keys],
        "by_hospital": [{"name": h["short_name"] or h["name"], "sessions": h["sessions"], "complete": h["complete"], "technology": h["technology"]}
                        for h in hospitals(rows)],
    }
