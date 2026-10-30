"""Prospective data for the portal, read from the master CSV pair (see the master CSV specification).

The portal never queries the live clinical databases for this: a build script writes
prospective_master.csv and prospective_files.csv, and this module reads the latest pair
from GCS (or a local folder while developing) and answers filter / count / detail questions.
"""
import csv
import hashlib
import io
import json
import os
import threading
import time
from collections import Counter, defaultdict
from pathlib import Path
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


DEFAULT_TEST_FILE = Path(__file__).resolve().parents[1] / "data" / "test_hospitals.csv"


def hospital_table() -> Dict[str, dict]:
    """hospital_id -> {is_test}. Hospitals and pilot sites whose sessions are test data (backend/src/data/test_hospitals.csv)."""
    path = Path(os.environ.get("PROSPECTIVE_TEST_HOSPITALS_FILE") or DEFAULT_TEST_FILE)
    if not path.is_file():
        return {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        return {r["hospital_id"].strip(): {"is_test": (r.get("is_test") or "").strip() == "1"} for r in csv.DictReader(f)}


def technology(row: dict, table: Dict[str, dict] = None) -> str:
    """CR or DR of a session's hospital: the hospital's own type in the database (hospitals.type, CSV column hospital_type).
    Falls back to an exact CR / DR in the machine technology text, else 'Unknown' (shown as Not set)."""
    t = (row.get("hospital_type") or "").strip().upper()
    if t in ("CR", "DR"):
        return t
    kinds = {v.strip().upper() for v in _as_list(row.get("mammo_technology"))} & {"CR", "DR"}
    return kinds.pop() if len(kinds) == 1 else "Unknown"


def _as_list(value) -> List[str]:
    """A machine field is one text value, or a JSON list when a hospital has several machines."""
    v = (value or "").strip()
    if v.startswith("["):
        try:
            return [str(x).strip() for x in json.loads(v)]
        except ValueError:
            pass
    return [v] if v else []


def machines_of(rows: List[dict]) -> dict:
    """A hospital's equipment as the master CSV records it: the distinct machine names, makes and technologies (each column is
    a JSON list when there are several), and how many machines there are in total."""
    def distinct(col):
        out: List[str] = []
        for r in rows:
            for v in _as_list(r.get(col)):
                if v and v not in out:
                    out.append(v)
        return out
    counts = [int(r["n_machines_at_hospital"]) for r in rows if str(r.get("n_machines_at_hospital", "")).isdigit()]
    names = distinct("mammo_machine")
    return {"names": names, "makes": distinct("mammo_make"), "technologies": distinct("mammo_technology"),
            "total": max(counts) if counts else len(names), "unique": len(names)}


def load(force: bool = False) -> dict:
    """Read the master pair. PROSPECTIVE_MANIFEST_URI (the build tool's current.json) points at the latest build and is checked
    against its checksums and counts; otherwise the two CSV paths are used directly."""
    manifest_uri = os.environ.get("PROSPECTIVE_MANIFEST_URI", "").strip()
    master_uri, files_uri = _uris()
    if not manifest_uri and not master_uri:
        raise NotConfigured("PROSPECTIVE_MANIFEST_URI or PROSPECTIVE_MASTER_URI is not set")
    key = (manifest_uri, master_uri, files_uri)
    with _lock:
        if not force and _cache["data"] and _cache["key"] == key and time.time() - _cache["at"] < CACHE_SECONDS:
            return _cache["data"]
        manifest = json.loads(_read(manifest_uri)) if manifest_uri else None
        if manifest:
            master_uri, files_uri = manifest["master_uri"], manifest["files_uri"]
        master_text = _read(master_uri)
        files_text = _read(files_uri) if files_uri else ""
        if manifest:                                         # never show a half-written or altered build
            for name, body in (("master", master_text), ("files", files_text)):
                if hashlib.sha256(body.encode("utf-8")).hexdigest() != manifest.get(f"{name}_sha256"):
                    raise ValueError(f"The {name} CSV does not match its checksum in the manifest")
        rows = list(csv.DictReader(io.StringIO(master_text)))
        files = list(csv.DictReader(io.StringIO(files_text))) if files_uri else []
        if manifest and (len(rows) != manifest.get("rows") or len(files) != manifest.get("files")):
            raise ValueError("The CSV row counts do not match the manifest")
        table = hospital_table()
        for r in rows:
            r["_tech"] = technology(r, table)
            if table.get(r.get("hospital_id", ""), {}).get("is_test"):
                r["is_test"] = "1"                   # test hospitals and test pilot sites are marked here, not only in the CSV
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
    wanted_hospitals = {h.strip() for h in hospital_id.split(",") if h.strip()}      # one id, or a hospital with its pilot sites
    out = []
    for r in rows:
        if not include_test and flag(r, "is_test"):
            continue
        if source and r.get("data_source") != source:
            continue
        if wanted_hospitals and r.get("hospital_id") not in wanted_hospitals:
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


def _pilot_parent_name(name: str) -> str:
    """'Pilot Study - X' (or 'Pilot Study -X') -> 'X'; anything else -> ''."""
    n = (name or "").strip()
    if n.lower().startswith("pilot study"):
        return n.split("-", 1)[1].strip() if "-" in n else ""
    return ""


def hospitals(rows: List[dict]) -> List[dict]:
    """One entry per hospital. A pilot site ('Pilot Study - X') is grouped under its parent hospital X when that hospital is present;
    each site keeps its own CR / DR as recorded in the database."""
    by_id: Dict[str, List[dict]] = defaultdict(list)
    for r in rows:
        by_id[r["hospital_id"]].append(r)
    names = {rs[0].get("hospital_name", "").strip().lower(): hid for hid, rs in by_id.items() if not _pilot_parent_name(rs[0].get("hospital_name", ""))}
    groups: Dict[str, List[str]] = defaultdict(list)           # parent id -> [parent id, pilot site ids...]
    for hid, rs in by_id.items():
        parent = names.get(_pilot_parent_name(rs[0].get("hospital_name", "")).lower()) if _pilot_parent_name(rs[0].get("hospital_name", "")) else None
        groups[parent or hid].append(hid)
    out = []
    for parent, ids in groups.items():
        ids = sorted(ids, key=lambda i: (i != parent, i))
        rs = [r for i in ids for r in by_id[i]]
        first = by_id[parent][0] if parent in by_id else rs[0]
        machines = machines_of(by_id[parent] if parent in by_id else rs)
        sites = [{"hospital_id": i, "name": by_id[i][0].get("hospital_name"), "technology": by_id[i][0]["_tech"],
                  "is_pilot_site": i != parent, **stats(by_id[i])} for i in ids]
        out.append({"hospital_id": parent, "hospital_ids": ids, "name": first.get("hospital_name"), "short_name": first.get("hospital_short_name"),
                    "state": first.get("hospital_state"), "technology": by_id[parent][0]["_tech"] if parent in by_id else first["_tech"],
                    "machines": machines, "unique_machines": machines["unique"], "sites": sites,
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
