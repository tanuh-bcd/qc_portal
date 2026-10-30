"""Write a synthetic prospective_master.csv / prospective_files.csv pair that follows the master CSV spec.

For trying the Prospective screens and the Dashboard before the real build script exists.
No real data: ids, hospitals and values are made up.   Usage: python make_prospective_sample.py OUT_DIR
"""
import csv
import json
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))
BUCKET = "gs://breast-cancer-image-dataset/tanuh-data-capture"
HOSPITALS = [  # id, name, short, state, type, machine, make, technology
    ("clinic_00001", "Tanuh Foundation", "TANUH", "Karnataka", "Research", "Selenia", "Hologic", "DR"),
    ("clinic_00005", "Kidwai Memorial Institute", "KMIO", "Karnataka", "Government", "Senographe", "GE", "DR"),
    ("clinic_00008", "Sri Shankara Cancer Hospital", "SSCH", "Karnataka", "Private", "Mammomat", "Siemens", "CR"),
    ("clinic_00011", "Government Hospital Mysuru", "GHM", "Karnataka", "Government", "Alpha ST", "Fujifilm", "CR"),
    ("clinic_00012", "Regional Cancer Centre", "RCC", "Kerala", "Government", "Selenia Dimensions", "Hologic", "DR"),
    ("clinic_00014", "Community Health Centre Hosur", "CHC", "Tamil Nadu", "Public", "Fischer", "Hologic", "CR"),
    ("clinic_00017", "City Imaging Clinic", "CIC", "Maharashtra", "Private", "Senographe Pristina", "GE", "DR"),
]
VIEWS = [("mammo_cc_right", "CC", "R"), ("mammo_cc_left", "CC", "L"), ("mammo_mlo_right", "MLO", "R"), ("mammo_mlo_left", "MLO", "L")]
DENS = "ABCD"


def main(out: Path, n: int = 420, seed: int = 7):
    rnd = random.Random(seed)
    out.mkdir(parents=True, exist_ok=True)
    built = datetime.now(IST).isoformat(timespec="seconds")
    master, files = [], []
    subjects = {}
    start = datetime(2026, 2, 1, tzinfo=IST)
    for i in range(n):
        h = rnd.choices(HOSPITALS, weights=[1, 4, 3, 2, 3, 2, 2])[0]
        is_test = h[0] == "clinic_00001"
        pilot = rnd.random() < 0.35
        sid = str(uuid.UUID(int=rnd.getrandbits(128), version=4))
        subj = f"{h[2]}-{rnd.randint(1000, 1400)}"
        key = f"{h[0]}|{subj.upper()}"
        t0 = start + timedelta(days=rnd.randint(0, 240), hours=rnd.randint(8, 17), minutes=rnd.randint(0, 59))
        has_assess = rnd.random() < 0.82
        views = rnd.choices([4, 3, 2, 0], weights=[78, 8, 6, 8])[0] if has_assess else 0
        br = rnd.choices([0, 1, 2, 3, 4, 5, 6], weights=[3, 38, 24, 14, 12, 6, 3])
        bl = rnd.choices([0, 1, 2, 3, 4, 5, 6], weights=[3, 38, 24, 14, 12, 6, 3])
        dr_, dl_ = rnd.choices(DENS, weights=[10, 38, 36, 16])[0], rnd.choices(DENS, weights=[10, 38, 36, 16])[0]
        bmax = max(br[0], bl[0]) if has_assess else None
        dmax = max(dr_, dl_) if has_assess else None
        consent = (not pilot) and rnd.random() < 0.93
        report = has_assess and rnd.random() < 0.7
        complete = bool(has_assess and views == 4 and (consent or pilot))
        missing = [m for m, ok in [("consent", consent or pilot), ("all_4_views", views == 4), ("birads", has_assess), ("density", has_assess), ("mammo_report", report)] if not ok]
        row = {
            "session_id": sid, "is_pilot": int(pilot), "data_source": "pilot" if pilot else "portal",
            "hospital_id": h[0], "hospital_name": h[1], "hospital_short_name": h[2], "hospital_state": h[3], "hospital_type": h[4],
            "hospital_match_status": "matched", "subject_id": subj, "subject_key": key,
            "session_start_at": t0.isoformat(timespec="seconds"), "enrolment_month": t0.strftime("%Y-%m"),
            "enrolment_quarter": f"{t0.year}-Q{(t0.month - 1) // 3 + 1}",
            "questionnaire_type": "pilot_10q" if pilot else rnd.choice(["portal_v1", "portal_v2"]),
            "has_consent": int(consent), "consent_not_captured_by_design": int(pilot),
            "age": rnd.randint(30, 70), "bmi": round(rnd.uniform(18, 36), 1),
            "tobacco_use": rnd.choice(["Yes", "No", "No", "No"]), "alcohol_use": rnd.choice(["Yes", "No", "No"]),
            "snehita_risk_category": "" if pilot else rnd.choice(["Low", "Moderate", "High"]),
            "pilot_risk_class": rnd.choice(["HIGH_RISK", "LOW_RISK", "LOW_RISK"]) if pilot else "",
            "pilot_model_version": "pilot-P3-2026-09-28" if pilot else "",
            "has_assessment": int(has_assess), "birads_right": br[0] if has_assess else "", "birads_left": bl[0] if has_assess else "",
            "density_right": dr_ if has_assess else "", "density_left": dl_ if has_assess else "",
            "birads_max": bmax if has_assess else "", "density_max": dmax or "",
            "outcome_high_risk": int(has_assess and (bmax in (3, 4, 5) or dmax in ("C", "D"))) if has_assess else "",
            "n_views_present": views, "has_all_4_views": int(views == 4), "has_mammo_report": int(bool(report)),
            "has_us": int(has_assess and rnd.random() < 0.3), "has_biopsy": int(has_assess and bmax in (4, 5, 6) and rnd.random() < 0.6),
            "is_complete_datapoint": int(complete), "missing_components": json.dumps(missing),
            "mammo_machine": h[5], "mammo_make": h[6], "mammo_technology": h[7],
            "upload_clinic_id": h[0], "is_test": int(is_test), "master_built_at": built, "master_build_version": "sample-0.1",
            "questionnaire_answers_json": json.dumps([
                {"question_key": "age", "question": "Age", "answer": str(rnd.randint(30, 70))},
                {"question_key": "q9", "question": "Have you had cancer before?", "answer": rnd.choice(["Yes", "No", "No", "No"])},
                {"question_key": "q10", "question": "Family history of breast cancer?", "answer": rnd.choice(["Yes", "No", "No"])}]),
        }
        subjects.setdefault(key, []).append(row)
        master.append(row)
        if has_assess:
            aid = 1000 + i
            for k, (ft, view, lat) in enumerate(VIEWS[:views]):
                files.append({
                    "session_id": sid, "is_pilot": int(pilot), "hospital_id": h[0], "assessment_id": aid, "attachment_id": 50000 + i * 10 + k,
                    "file_type": ft, "file_category": "mammogram", "view": view, "laterality": lat,
                    "gcs_path": f"{BUCKET}/{h[0]}/{sid}/mammogram/{h[0]}_{sid}_{ft}_{t0.strftime('%Y%m%d')}.dcm",
                    "original_file_name": f"{ft}.dcm", "file_extension": "dcm", "mime_type": "application/dicom",
                    "uploaded_at": (t0 + timedelta(days=1)).isoformat(timespec="seconds"), "upload_clinic_id": h[0], "seq": "", "is_latest_of_type": 1})
            if report:
                files.append({
                    "session_id": sid, "is_pilot": int(pilot), "hospital_id": h[0], "assessment_id": aid, "attachment_id": 50000 + i * 10 + 8,
                    "file_type": "mammo_reading", "file_category": "mammo_report", "view": "", "laterality": "",
                    "gcs_path": f"{BUCKET}/{h[0]}/{sid}/mammogram-report/{h[0]}_{sid}_mammo_reading_{t0.strftime('%Y%m%d')}.pdf",
                    "original_file_name": "report.pdf", "file_extension": "pdf", "mime_type": "application/pdf",
                    "uploaded_at": (t0 + timedelta(days=1)).isoformat(timespec="seconds"), "upload_clinic_id": h[0], "seq": "", "is_latest_of_type": 1})
        if consent:
            files.append({
                "session_id": sid, "is_pilot": 0, "hospital_id": h[0], "assessment_id": "", "attachment_id": "", "file_type": "consent",
                "file_category": "consent", "view": "", "laterality": "", "gcs_path": f"{BUCKET}/consent/{sid}_consent_{t0.strftime('%Y%m%d')}.jpg",
                "original_file_name": "consent.jpg", "file_extension": "jpg", "mime_type": "image/jpeg",
                "uploaded_at": t0.isoformat(timespec="seconds"), "upload_clinic_id": h[0], "seq": "", "is_latest_of_type": 1})
    for rows in subjects.values():                       # repeat sessions of one subject
        rows.sort(key=lambda r: r["session_start_at"])
        for seq, r in enumerate(rows, 1):
            r["n_sessions_for_subject"], r["session_sequence_for_subject"] = len(rows), seq
            r["is_latest_session_for_subject"] = int(seq == len(rows))
    for name, rows in (("prospective_master.csv", master), ("prospective_files.csv", files)):
        cols = list(dict.fromkeys(c for r in rows for c in r))
        with open(out / name, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)
    print(f"wrote {len(master)} sessions and {len(files)} files to {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "."))
