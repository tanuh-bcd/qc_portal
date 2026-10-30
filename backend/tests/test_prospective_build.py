"""Build tool tests: repeats, two sources, unknown linkage, invalid releases, and that the extractor reads only allow-listed columns."""
import csv
import io
import json
from copy import deepcopy
from datetime import datetime


import pytest

from backend.src.services import prospective_contract as pd
from backend.src.services.prospective_build import build, csv_text, extract, publish

BASE = "gs://breast-cancer-image-dataset/tanuh-data-capture"



@pytest.fixture
def tables():
    t = {"hospitals": [{"id": "clinic_a", "name": "Hospital A", "short_name": "A"}, {"id": "clinic_b", "name": "Hospital B"}],
         "machines": [{"hospital_id": "clinic_a", "technology": "CR", "no_of_machines": 1}, {"hospital_id": "clinic_a", "technology": "DR", "no_of_machines": 1}],
         "session_table": [{"session_id": s, "session_start_time": f"2026-10-{i + 1:02d} 20:00:00", "questionnaire_version": 2 if s == "portal" else 1} for i, s in enumerate(["portal", "pilot", "repeat", "other_hospital", "unlinked", "abandoned"])],
         "session_data_table": [], "patient_details": [{"session_id": "pilot", "institute": "Hospital A", "subject_id": " abc ", "age": 42}],
         "pilot_questionnaire": [{"session_id": "pilot", "question_key": "q4", "question": "Hormonal treatment?", "answer": "Yes"}],
         "pilot_result": [{"session_id": "pilot", "risk_class": "LOW_RISK", "model_version": "P3", "risk_score": 0.25}],
         "subjects": [{"institute": "Hospital A", "subject_id": "ABC", "source": "both", "pilot_session_id": "pilot", "data_collection_session_id": "portal"}],
         "doctor_assessments": [], "attachments": [], "users": [], "roles": []}
    for s in t["session_table"]:
        sid = s["session_id"]
        if sid in {"pilot", "abandoned"}: continue
        hospital = "Hospital B" if sid == "other_hospital" else "Hospital A"
        # Exercise actual V2 identity keys and keyless legacy text aliases.
        t["session_data_table"].extend([
            {"session_id": sid, "question_key": "V2_Q02" if sid == "portal" else "", "question": "Institute Name:", "answer": hospital},
            {"session_id": sid, "question_key": "V2_Q01" if sid == "portal" else "", "question": "Enter your subject ID:", "answer": "" if sid == "unlinked" else "ABC"},
            {"session_id": sid, "question_key": "Q4", "question": "State?", "answer": "Karnataka"},
        ])
    for i, sid in enumerate(["portal", "repeat", "other_hospital", "unlinked"], 1):
        t["doctor_assessments"].append({"id": i, "patient_session_id": sid, "created_at": "2026-10-10 11:00:00",
                                        "mammo_birads": "2", "us_biopsy_birads": "4", "mammo_density": "B", "us_biopsy_density": "C"})
    def add(aid, ft, n):
        t["attachments"].append({"id": n, "assessment_id": aid, "file_type": ft, "storage_url": f"{BASE}/clinic_a/session/mammogram/{ft}_{n}.dcm",
                                  "created_at": "2026-10-10 11:30:00", "file_name": f"{ft}.dcm"})
    for i, ft in enumerate(sorted(pd.VIEWS), 1): add(1, ft, i)
    add(1, "mammo_reading", 10)
    add(1, "mammo_reading", 11)  # Reupload, same subject and same report type.
    add(2, "biopsy_reading", 20)  # Material on a later session of the same woman.
    add(2, "us_reading", 21)
    add(2, "additional_histopathology1", 22)
    add(2, "additional_ihc", 23)
    add(3, "mammo_reading", 30)  # Same typed ID, different hospital = different woman.
    add(4, "mammo_reading", 40)  # No subject ID: count as unlinked session only.
    return t


def test_build_links_and_clinical_sides(tables):
    rows, files, report, _ = build(tables)
    by_id = {r["session_id"]: r for r in rows}
    assert report["excluded_sessions"] == 1 and report["included_pilot_sessions"] == 1
    assert by_id["portal"]["subject_key"] == by_id["pilot"]["subject_key"] == "clinic_a|ABC"
    assert by_id["other_hospital"]["subject_key"] == "clinic_b|ABC"
    assert by_id["unlinked"]["subject_key"] == ""
    assert by_id["portal"]["session_start_at"] == "2026-10-02T01:30:00+05:30"
    assert by_id["portal"]["birads_right"] == "2" and by_id["portal"]["birads_left"] == "4"
    assert by_id["portal"]["density_left"] == "C"
    assert by_id["portal"]["hormonal_contraception_or_hrt"] == ""  # Q4 is the portal state question.
    assert by_id["pilot"]["hormonal_contraception_or_hrt"] == "Yes"
    assert by_id["repeat"]["is_latest_session_for_subject"] == "1"
    assert by_id["portal"]["linked_pilot_session_id"] == "pilot"
    assert sum(f["is_latest_of_type"] == "1" for f in files if f["session_id"] == "portal" and f["file_type"] == "mammo_reading") == 1
    assert by_id["portal"]["path_mammo_report"].endswith("_11.dcm")



def test_duplicate_or_orphan_records_fail(tables):
    rows, files, _, _ = build(tables)
    with pytest.raises(ValueError, match="unique"):
        pd.validate(rows + [rows[0]], files)
    orphan = deepcopy(files)
    orphan[0]["session_id"] = "missing"
    with pytest.raises(ValueError, match="absent"):
        pd.validate(rows, orphan)
    duplicate = deepcopy(files)
    duplicate.append(next(f for f in duplicate if f["is_latest_of_type"] == "1"))
    with pytest.raises(ValueError, match="latest"):
        pd.validate(rows, duplicate)
    rows[0]["has_biopsy"] = "1"
    with pytest.raises(ValueError, match="inventory"):
        pd.validate(rows, files)


def test_unknown_attachment_does_not_publish(tables):
    tables["attachments"][0]["file_type"] = "new_unknown_type"
    with pytest.raises(ValueError, match="Unmapped"):
        build(tables)



def test_extractor_is_allowlisted_and_select_only():
    from sqlalchemy import create_engine, text
    from backend.src.services.prospective_build import SOURCE_COLUMNS, REQUIRED_SOURCE
    engines = {k: create_engine("sqlite://") for k in SOURCE_COLUMNS}
    try:
        for source, tables in SOURCE_COLUMNS.items():
            with engines[source].begin() as conn:
                for name in tables:
                    cols = sorted(REQUIRED_SOURCE[name] | {"sensitive_unlisted_field"})
                    conn.execute(text(f'CREATE TABLE "{name}" (' + ', '.join(f'"{c}" TEXT' for c in cols) + ')'))
                    conn.execute(text(f'INSERT INTO "{name}" (sensitive_unlisted_field) VALUES (\'never-export\')'))
        extracted = extract(engines)
        assert all("sensitive_unlisted_field" not in row for rows in extracted.values() for row in rows)
    finally:
        for e in engines.values(): e.dispose()


def test_portal_reader_follows_the_manifest_and_rejects_tampering(tables, tmp_path, monkeypatch):
    from backend.src.services import prospective_data as reader
    rows, files, report, built_at = build(tables)
    manifest = publish(rows, files, report, built_at, str(tmp_path))
    monkeypatch.delenv("PROSPECTIVE_MASTER_URI", raising=False)
    monkeypatch.delenv("PROSPECTIVE_DIR", raising=False)
    monkeypatch.setenv("PROSPECTIVE_MANIFEST_URI", manifest)
    reader.reset_cache()
    data = reader.load()
    assert len(data["rows"]) == len(rows) and data["n_files"] == len(files)
    assert all(r["_tech"] in ("CR", "DR", "Unknown") for r in data["rows"])
    master_path = json.load(open(manifest))["master_uri"]
    with open(master_path, "a", encoding="utf-8") as f:                       # alter the published file after the fact
        f.write("x")
    reader.reset_cache()
    with pytest.raises(ValueError, match="checksum"):
        reader.load()
    reader.reset_cache()


def test_pilot_rows_without_a_session_are_reported_not_fatal(tables):
    tables["patient_details"].append({"session_id": "ghost", "institute": "E2E-TEST", "subject_id": "E2E-1", "age": 30})
    rows, files, report, _ = build(tables)
    assert report["excluded_orphan_pilot_sessions"] == 1 and report["orphan_pilot_institutes"] == ["e2e-test"]
    assert "ghost" not in {r["session_id"] for r in rows}
    assert any("no questionnaire session" in w for w in report["warnings"])
