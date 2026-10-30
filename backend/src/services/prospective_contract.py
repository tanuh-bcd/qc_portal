"""The master CSV contract: required columns and the checks a build must pass before it is published.

Shared by the build tool (services/prospective_build.py). The portal's reader (prospective_data.py) is deliberately more lenient.
"""
import csv
import io
from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

VIEWS = {"mammo_cc_right", "mammo_cc_left", "mammo_mlo_right", "mammo_mlo_left"}
REQUIRED_MASTER = {"session_id", "data_source", "hospital_id", "subject_key", "session_start_at", "is_test",
                   "has_assessment", "is_complete_datapoint", "master_built_at", "master_build_version"}
REQUIRED_FILES = {"session_id", "file_type", "file_category", "gcs_path", "is_latest_of_type"}


def flag(row, col):
    return str(row.get(col, "")).strip() == "1"


def parse_csv(body, required):
    reader = csv.DictReader(io.StringIO(body))
    columns = reader.fieldnames or []
    missing = required - set(columns)
    if missing:
        raise ValueError("Missing CSV columns: " + ", ".join(sorted(missing)))
    if len(columns) != len(set(columns)):
        raise ValueError("Duplicate CSV columns")
    rows = list(reader)
    if any(None in r or any(v is None for v in r.values()) for r in rows):
        raise ValueError("Malformed CSV row")
    return rows, columns


def validate(rows, files):
    ids = [r["session_id"] for r in rows]
    if any(not s for s in ids) or len(ids) != len(set(ids)):
        raise ValueError("Master session_id must be nonempty and unique")
    known = set(ids)
    for r in rows:
        if r.get("data_source") not in {"portal", "pilot"}:
            raise ValueError("Invalid data_source")
        for c in ("birads_right", "birads_left"):
            if r.get(c, "") not in {"", "0", "1", "2", "3", "4", "5", "6"}:
                raise ValueError(f"Invalid {c}")
        for c in ("density_right", "density_left"):
            if r.get(c, "") not in {"", "A", "B", "C", "D"}:
                raise ValueError(f"Invalid {c}")
        for c, v in r.items():
            if c.startswith(("has_", "is_", "outcome_")) or c in {"consent_not_captured_by_design", "upload_clinic_mismatch"}:
                if v not in {"", "0", "1"}:
                    raise ValueError(f"Invalid boolean {c}")
        if r.get("paths_other_files", "") not in {"", "[]"}:
            raise ValueError("Unmapped file types in paths_other_files")
        for c in ("session_start_at", "master_built_at"):
            if r.get(c):
                if datetime.fromisoformat(r[c]).utcoffset() != datetime.now(ZoneInfo("Asia/Kolkata")).utcoffset():
                    raise ValueError(f"{c} requires the IST offset (+05:30)")
        if r.get("subject_key") and (not r.get("hospital_id") or not r["subject_key"].startswith(r["hospital_id"] + "|")):
            raise ValueError("subject_key must be hospital-scoped")
    for c in ("master_build_version", "master_built_at"):
        if len({r[c] for r in rows}) > 1:
            raise ValueError("Mixed master build versions or timestamps")
    latest = Counter()
    for f in files:
        if f["session_id"] not in known:
            raise ValueError("File references a session absent from master")
        if not f["gcs_path"].startswith("gs://breast-cancer-image-dataset/"):
            raise ValueError("File path is outside the prospective bucket")
        if f["is_latest_of_type"] not in {"0", "1"}:
            raise ValueError("Invalid is_latest_of_type")
        ft = f["file_type"]
        expected_category = "mammogram" if ft in VIEWS or ft == "mammo_dicom" else "annotation" if ft.startswith("annot_") else "additional" if ft.startswith("additional_") else {"mammo_reading": "mammo_report", "us_video": "ultrasound", "us_reading": "us_report", "biopsy_reading": "biopsy", "consent": "consent"}.get(ft)
        if not expected_category or f["file_category"] != expected_category:
            raise ValueError("Unknown file type or inconsistent file category")
        if flag(f, "is_latest_of_type"):
            latest[(f["session_id"], f["file_type"])] += 1
    if any(latest[(f["session_id"], f["file_type"])] != 1 for f in files):
        raise ValueError("Each session/file type must have exactly one latest file")
    by_session = defaultdict(list)
    for f in files: by_session[f["session_id"]].append(f)
    for r in rows:
        actual = delivery(r, by_session[r["session_id"]])
        for col, key in (("has_all_4_views", "four_views"), ("has_mammo_report", "mammo_report"), ("has_us", "us"), ("has_biopsy", "biopsy"), ("has_histopathology", "histopathology")):
            if r.get(col, "") != "" and flag(r, col) != actual[key]:
                raise ValueError(f"{col} does not agree with the file inventory")
        if flag(r, "is_complete_datapoint"):
            if not actual["four_views"] or not flag(r, "has_assessment") or any(not r.get(c) for c in ("birads_right", "birads_left", "density_right", "density_left")):
                raise ValueError("Complete datapoint is missing required imaging or clinical fields")
            if "has_questionnaire" in r and not flag(r, "has_questionnaire"):
                raise ValueError("Complete datapoint is missing questionnaire answers")
            if r["data_source"] != "pilot" and not flag(r, "has_consent"):
                raise ValueError("Complete portal datapoint is missing consent")


def delivery(row, files):
    types = {f["file_type"] for f in files}
    categories = {f["file_category"] for f in files}
    return {
        "mammogram": "mammogram" in categories,
        "four_views": VIEWS <= types,
        "mammo_report": "mammo_reading" in types,
        "additional": any(t.startswith("additional_") for t in types),
        "ultrasound": "us_video" in types,
        "us_report": "us_reading" in types,
        "us": bool(types & {"us_video", "us_reading"}),
        "biopsy": "biopsy_reading" in types,
        "histopathology": any(t.startswith("additional_histopathology") for t in types),
        "ihc": any(t.startswith("additional_ihc") for t in types),
        "complete": flag(row, "is_complete_datapoint"),
    }
