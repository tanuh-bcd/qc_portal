"""Read-only source extraction and versioned publication of the prospective CSV pair.

Does not import QC database models: these are the original clinical databases, not
qc_* replicas. No writes, emails or object-listing calls are made to source systems.
"""
import csv
import hashlib
import io
import json
import os
import re
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from . import prospective_contract as pd

IST = ZoneInfo("Asia/Kolkata")
VERSION = "prospective-v1"
# Explicit column allowlists prevent accidental export of credentials, IPs or contact fields.
SOURCE_COLUMNS = {
    "questionnaire": {
        "session_table": "session_id session_start_time session_end_time questionnaire_version consent_url snehita_lifetime_risk risk_category language",
        "session_data_table": "session_id question_key question answer created_at",
    },
    "clinical": {
        "hospitals": "id name short_name state type",
        "machines": "id hospital_id machine make technology no_of_machines",
        "doctor_assessments": "id patient_session_id doctor_id questionnaire_feedback is_questionnaire_correct mammo_birads mammo_density us_biopsy_birads us_biopsy_density precision_diagnosis datapoint_feedback clinical_findings recommendation_followup routine_views_uploaded doctor_risk_class doctor_case_notes created_at",
        "attachments": "id assessment_id file_type file_name storage_url mime_type created_at",
        "users": "id role_id", "roles": "id name",
    },
    "pilot": {
        "patient_details": "id session_id institute subject_id age height_cm weight_kg tobacco_use alcohol_use created_at",
        "pilot_questionnaire": "id session_id question_key question answer created_at",
        "pilot_result": "id session_id risk_class risk_score recommendation model_version created_at",
        "subjects": "id institute subject_id source pilot_session_id data_collection_session_id",
    },
}
REQUIRED_SOURCE = {
    "session_table": {"session_id", "session_start_time", "consent_url"}, "session_data_table": {"session_id", "question", "answer"},
    "hospitals": {"id", "name"}, "machines": {"hospital_id", "technology"},
    "doctor_assessments": {"id", "patient_session_id", "created_at", "mammo_birads", "us_biopsy_birads", "mammo_density", "us_biopsy_density"},
    "attachments": {"id", "assessment_id", "file_type", "storage_url", "created_at"},
    "users": {"id", "role_id"}, "roles": {"id", "name"},
    "patient_details": {"session_id", "institute", "subject_id"},
    "pilot_questionnaire": {"session_id", "question_key", "answer"},
    "pilot_result": {"session_id", "risk_class", "model_version"},
    "subjects": {"institute", "subject_id", "pilot_session_id", "data_collection_session_id"},
}
RISK_KEYS = dict(zip(
    "age_at_menarche menopause_answer irregular_periods pcos hormonal_contraception_or_hrt age_first_birth num_full_term_pregnancies breastfeeding_months fertility_treatment prior_breast_problem own_cancer_history own_cancer_type family_cancer_history family_relation family_cancer_type".split(),
    "q1_age q2_age q3a q3b q4 q5_age q5_count q6 q7 q8 q9 q9_type q10 q10_who q10_type".split()))
VIEW_PATHS = {t: "path_" + t for t in pd.VIEWS}
SINGLE_PATHS = {**VIEW_PATHS, "mammo_reading": "path_mammo_report", "us_reading": "path_us_report", "biopsy_reading": "path_biopsy_report",
                **{f"annot_{v}": f"path_annot_{v}" for v in ("cc_right", "cc_left", "mlo_right", "mlo_left")}}
MULTI_PATHS = {"mammo_dicom": "paths_mammo_dicom_other", "us_video": "paths_us_video",
               **{f"additional_{k}": f"paths_{k}" for k in ("histopathology", "ihc", "prior_imaging", "other_imaging", "additional_mammo_views")}}
MULTI_PATHS["additional_mammo_views"] = "paths_additional_mammo_views"
MULTI_PATHS.pop("additional_additional_mammo_views", None)
FINDINGS = "mass mass_location mass_description calcification calcification_type architectural_distortion focal_asymmetry asymmetry skin_thickening nipple_retraction lymph_nodes lymph_nodes_type findings_comments".split()


def value(v):
    if v is None: return ""
    if isinstance(v, bool): return str(int(v))
    if isinstance(v, (dict, list)): return json.dumps(v, ensure_ascii=False, default=str)
    return str(v)


def stamp(v, source_tz=IST):
    if not v: return ""
    dt = v if isinstance(v, datetime) else datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    if dt.tzinfo is None: dt = dt.replace(tzinfo=source_tz)
    return dt.astimezone(IST).isoformat(timespec="seconds")


def normal(v):
    return str(v or "").strip().casefold()


def group(rows, key):
    out = defaultdict(list)
    for r in rows: out[value(r.get(key))].append(r)
    return out


def latest(rows):
    return max(rows, key=lambda r: (value(r.get("created_at")), value(r.get("id")).zfill(20))) if rows else {}


def extract(engines):
    """SELECT only. Operators must supply SELECT-only database accounts."""
    from sqlalchemy import MetaData, Table, select
    result = {}
    for source, specs in SOURCE_COLUMNS.items():
        engine = engines[source]
        with engine.connect() as conn:
            if conn.dialect.name == "mysql":
                conn.exec_driver_sql("SET TRANSACTION READ ONLY")
                conn.exec_driver_sql("SET time_zone = '+00:00'" if source == "questionnaire" else "SET time_zone = '+05:30'")
            for name, columns in specs.items():
                table = Table(name, MetaData(), autoload_with=conn)
                missing = REQUIRED_SOURCE[name] - set(table.c.keys())
                if missing: raise ValueError(f"Source schema {source}.{name} missing: {', '.join(sorted(missing))}")
                selected = [table.c[c] for c in columns.split() if c in table.c]
                result[name] = [dict(r) for r in conn.execute(select(*selected)).mappings()]
    return result


def file_category(ft):
    if ft in pd.VIEWS or ft == "mammo_dicom": return "mammogram"
    if ft.startswith("annot_"): return "annotation"
    return {"mammo_reading": "mammo_report", "us_video": "ultrasound", "us_reading": "us_report", "biopsy_reading": "biopsy", "consent": "consent"}.get(ft, "additional")


def build(tables, version=VERSION):
    built_at = datetime.now(IST).isoformat(timespec="seconds")
    get = lambda name: tables.get(name, [])
    sessions = get("session_table")
    answers = group(get("session_data_table"), "session_id")
    details = group(get("patient_details"), "session_id")
    pilot_answers, results = group(get("pilot_questionnaire"), "session_id"), group(get("pilot_result"), "session_id")
    assessments = group(get("doctor_assessments"), "patient_session_id")
    attachments = group(get("attachments"), "assessment_id")
    machines = group(get("machines"), "hospital_id")
    hospitals = {}
    for h in get("hospitals"):
        key = normal(h["name"])
        if key in hospitals: raise ValueError("Hospital names are ambiguous after normalisation")
        hospitals[key] = h
    roles = {value(r["id"]): r["name"] for r in get("roles")}
    users = {value(u["id"]): roles.get(value(u.get("role_id")), "") for u in get("users")}
    registry = {(normal(r.get("institute")), normal(r.get("subject_id"))): r for r in get("subjects")}
    master, files = [], []
    excluded = 0
    warnings = []
    session_ids = {value(s["session_id"]) for s in sessions}
    # Pilot rows whose questionnaire session no longer exists (the live data has a few, all test records) cannot be dated or
    # linked, so they are left out and reported rather than stopping the whole build.
    orphans = sorted(s for s in details if s not in session_ids)
    orphan_institutes = sorted({normal(latest(details[s]).get("institute")) for s in orphans})
    if orphans: warnings.append(f"{len(orphans)} pilot detail rows have no questionnaire session and were left out")
    for s in sessions:
        sid = value(s["session_id"])
        pilot = bool(details[sid])
        detail = latest(details[sid])
        aa = pilot_answers[sid] if pilot else answers[sid]
        by_key = {normal(a.get("question_key")): value(a.get("answer")) for a in aa if a.get("question_key")}
        by_text = {normal(a.get("question")).rstrip(":?"): value(a.get("answer")) for a in aa}
        def answer(*labels):
            for label in labels:
                found = by_key.get(normal(label), by_text.get(normal(label).rstrip(":?"), ""))
                if found != "": return found
            return ""
        hospital_name = value(detail.get("institute")) if pilot else answer("V2_Q02", "Q45", "Institute Name", "Enter the Hospital ID(If any, else leave):", "Enter the Institution Name (If any, else leave)")
        h = hospitals.get(normal(hospital_name), {})
        if not pilot and not h:
            excluded += 1
            continue
        hid = value(h.get("id"))
        subject_id = value(detail.get("subject_id")) if pilot else answer("V2_Q01", "Q44", "Patient ID / Subject ID", "Patient ID", "Subject ID", "Enter your Patient ID(if any, else leave):", "Enter your subject ID:", "Enter Subject ID (if any, else leave)")
        subject_key = f"{hid}|{subject_id.strip().upper()}" if hid and subject_id.strip() else ""
        started = stamp(s.get("session_start_time"), timezone.utc)
        r = {"session_id": sid, "is_pilot": value(pilot), "data_source": "pilot" if pilot else "portal", "hospital_id": hid,
             "hospital_name": hospital_name, "hospital_match_status": "matched" if h else "unmatched", "subject_id": subject_id, "subject_key": subject_key,
             "session_start_at": started, "session_end_at": stamp(s.get("session_end_time"), timezone.utc),
             "pilot_details_saved_at": stamp(detail.get("created_at")), "pilot_result_at": stamp(latest(results[sid]).get("created_at")),
             "enrolment_month": started[:7], "enrolment_quarter": f"{started[:4]}-Q{(int(started[5:7]) - 1) // 3 + 1}" if started else "",
             "questionnaire_type": "pilot_10q" if pilot else "portal_v2" if value(s.get("questionnaire_version")) == "2" else "portal_v1",
             "questionnaire_version": value(s.get("questionnaire_version")), "questionnaire_language": value(s.get("language")),
             "n_answers": value(len(aa)), "has_questionnaire": value(any(value(a.get("answer")).strip() for a in aa)),
             "questionnaire_answers_json": value([{k: value(a.get(k)) for k in ("question_key", "question", "answer")} for a in aa]),
             "consent_path": value(s.get("consent_url")), "has_consent": value(bool(s.get("consent_url"))), "consent_not_captured_by_design": value(pilot),
             "snehita_lifetime_risk": "" if pilot else value(s.get("snehita_lifetime_risk")), "snehita_risk_category": "" if pilot else value(s.get("risk_category")),
             "is_test": value(normal(hospital_name) in {"test", "tanuh foundation", "e2e-test"}),
             "master_built_at": built_at, "master_build_version": version}
        for c in ("short_name", "state", "type"): r[f"hospital_{c}"] = value(h.get(c))
        for c, labels in {"age": ("V2_Q03", "Q1", "age", "What is your current age? (Please enter a number - years)", "What is your age?", "Age (in years)"), "height_cm": ("V2_Q04", "Q2", "height_cm", "What is your current height in cms?", "Height (in cm)", "Height"),
                          "weight_kg": ("V2_Q05", "Q3", "weight_kg", "What is your current Weight in kgs?", "Weight (in kg)", "Weight"), "tobacco_use": ("tobacco_use",), "alcohol_use": ("alcohol_use",)}.items():
            r[c] = value(detail.get(c)) if pilot else answer(*labels)
        try:
            height, weight = float(r["height_cm"]), float(r["weight_kg"])
            r["bmi"] = value(round(weight / (height / 100) ** 2, 2)) if 80 <= height <= 250 and 20 <= weight <= 350 else ""
        except (ValueError, ZeroDivisionError): r["bmi"] = ""
        # Pilot q4 and portal Q4 are different questions. Never conflate their keys.
        for c, key in RISK_KEYS.items(): r[c] = answer(key) if pilot else ""
        if not pilot:
            # Only directly equivalent questions are promoted; retain all other raw answers.
            for c, keys in {"age_at_menarche": ("V2_Q11A", "Q10", "At what age did you get your first menstrual period?"),
                            "age_first_birth": ("V2_Q13_AGE_FIRST_BIRTH", "Q16", "Please select your age at first child birth?"),
                            "breastfeeding_months": ("V2_Q13E", "Q17", "What is the total duration of breast feeding?"),
                            "own_cancer_history": ("Q42", "Have you ever been diagnosed with any type of cancer?"),
                            "family_cancer_history": ("Q20", "Have any relatives been diagnosed with any type of cancer?"),
                            "family_relation": ("Q21", "Please enter the relation with relative?"),
                            "family_cancer_type": ("Q23", "Please specify which types of cancer was he/she diagnosed with?")}.items():
                r[c] = answer(*keys)
        r["prior_breast_problem_details"] = answer("q8_details") if pilot else ""
        r["prior_breast_exam"] = answer("Q27", "Have you ever undergone a Clinical Breast Examination (CBE)?") if not pilot else ""
        if not r["questionnaire_language"] and not pilot: r["questionnaire_language"] = answer("Q46", "Preferred Language")
        for c in ("risk_class", "risk_score", "recommendation", "model_version"):
            r[f"pilot_{c}"] = value(latest(results[sid]).get(c)) if pilot else ""
        reg = registry.get((normal(hospital_name), normal(subject_id)), {}) if subject_id else {}
        for dest, src in (("subject_registry_source", "source"), ("linked_portal_session_id", "data_collection_session_id"), ("linked_pilot_session_id", "pilot_session_id")):
            r[dest] = value(reg.get(src))
        aa_assess = assessments[sid]
        a = latest(aa_assess)
        r.update(has_assessment=value(bool(a)), n_assessments=value(len(aa_assess)), assessment_id=value(a.get("id")),
                 assessment_created_at=stamp(a.get("created_at")), assessing_clinician_id=value(a.get("doctor_id")), assessing_clinician_role=value(users.get(value(a.get("doctor_id")))))
        for target, source in {"birads_right": "mammo_birads", "birads_left": "us_biopsy_birads", "density_right": "mammo_density", "density_left": "us_biopsy_density", "routine_views_confirmed": "routine_views_uploaded"}.items():
            r[target] = value(a.get(source))
        for c in ("precision_diagnosis", "doctor_risk_class", "recommendation_followup", "is_questionnaire_correct", "questionnaire_feedback", "datapoint_feedback", "doctor_case_notes"):
            r[c] = value(a.get(c))
        findings = a.get("clinical_findings") or {}
        if isinstance(findings, str): findings = json.loads(findings)
        for side in ("right", "left"):
            fs = findings.get(side, {})
            for c in FINDINGS: r[f"{c}_{side}"] = value(fs.get("comments" if c == "findings_comments" else c))
            r[f"birads_4_sub_{side}"] = value(fs.get("birads_4_sub"))
            flags = [v for k, v in fs.items() if k in {"mass", "calcification", "architectural_distortion", "focal_asymmetry", "asymmetry", "skin_thickening", "nipple_retraction", "lymph_nodes"} and v is not None]
            r[f"any_finding_{side}"] = value(any(v in (True, 1, "1") for v in flags)) if flags else ""
        bs, ds = [r[c] for c in ("birads_right", "birads_left") if r[c]], [r[c] for c in ("density_right", "density_left") if r[c]]
        r["birads_max"], r["density_max"] = max(bs, default=""), max(ds, default="")
        r["outcome_suspicious_finding"] = value(r["birads_max"] in {"3", "4", "5"}) if bs else ""
        r["outcome_dense_breast"] = value(r["density_max"] in {"C", "D"}) if ds else ""
        r["outcome_high_risk"] = "1" if "1" in (r["outcome_suspicious_finding"], r["outcome_dense_breast"]) else "0" if bs and ds else ""
        if started and r["assessment_created_at"]:
            r["days_session_to_assessment"] = value(round((datetime.fromisoformat(r["assessment_created_at"]) - datetime.fromisoformat(started)).total_seconds() / 86400, 2))
        else: r["days_session_to_assessment"] = ""
        session_files = []
        for assessment in aa_assess:
            for attachment in attachments[value(assessment["id"])]:
                ft, path = value(attachment.get("file_type")), value(attachment.get("storage_url"))
                parts = path.split("/")
                uploaded = stamp(attachment.get("created_at"))
                seq = re.search(r"-(\d+)_\d{8}\.", path)
                session_files.append({"session_id": sid, "is_pilot": value(pilot), "hospital_id": hid, "assessment_id": value(assessment["id"]),
                                      "attachment_id": value(attachment["id"]), "file_type": ft, "file_category": file_category(ft),
                                      "view": "CC" if "_cc_" in ft else "MLO" if "_mlo_" in ft else "",
                                      "laterality": "R" if ft.endswith("_right") else "L" if ft.endswith("_left") else "",
                                      "gcs_path": path, "original_file_name": value(attachment.get("file_name")), "file_extension": path.rsplit(".", 1)[-1].lower(),
                                      "mime_type": value(attachment.get("mime_type")), "uploaded_at": uploaded, "upload_clinic_id": parts[4] if len(parts) > 5 else "",
                                      "seq": seq.group(1) if seq else "", "is_latest_of_type": "0"})
        times = sorted(f["uploaded_at"] for f in session_files if f["uploaded_at"])
        r["first_file_uploaded_at"], r["last_file_uploaded_at"] = times[0] if times else "", times[-1] if times else ""
        if r["consent_path"]:
            match = re.search(r"_consent_(\d{8})\.", r["consent_path"])
            consent_date = datetime.strptime(match.group(1), "%Y%m%d").replace(tzinfo=timezone.utc).date().isoformat() if match else ""
            r["consent_uploaded_at"] = consent_date  # date only; exact upload time is unavailable
            session_files.append({"session_id": sid, "is_pilot": value(pilot), "hospital_id": hid, "assessment_id": "", "attachment_id": "",
                                  "file_type": "consent", "file_category": "consent", "view": "", "laterality": "", "gcs_path": r["consent_path"],
                                  "original_file_name": "", "file_extension": r["consent_path"].rsplit(".", 1)[-1], "mime_type": "", "uploaded_at": "",
                                  "upload_clinic_id": "", "seq": "", "is_latest_of_type": "1"})
        else: r["consent_uploaded_at"] = ""
        file_groups = group(session_files, "file_type")
        for ft, fs in file_groups.items():
            newest = max(fs, key=lambda f: (f["uploaded_at"], f["attachment_id"].zfill(20)))
            newest["is_latest_of_type"] = "1"
        for c in SINGLE_PATHS.values(): r[c] = ""
        for c in MULTI_PATHS.values(): r[c] = "[]"
        r["paths_other_files"] = "[]"
        multi = defaultdict(list)
        for ft, fs in file_groups.items():
            if ft == "consent": continue
            if ft in SINGLE_PATHS:
                r[SINGLE_PATHS[ft]] = next(f["gcs_path"] for f in fs if f["is_latest_of_type"] == "1")
            else:
                column = next((c for prefix, c in MULTI_PATHS.items() if ft == prefix or (prefix.startswith("additional_") and ft.startswith(prefix))), None)
                if not column: raise ValueError(f"Unmapped attachment file_type: {ft}")
                multi[column].extend(f["gcs_path"] for f in fs)
        for c, paths in multi.items(): r[c] = value(paths)
        dd = pd.delivery(r, session_files)
        r.update(n_views_present=value(len(pd.VIEWS & set(file_groups))), has_all_4_views=value(dd["four_views"]),
                 n_mammo_files=value(sum(f["file_category"] == "mammogram" for f in session_files)), n_files_total=value(sum(f["file_type"] != "consent" for f in session_files)),
                 has_mammo_report=value(dd["mammo_report"]), has_us=value(dd["us"]), has_biopsy=value(dd["biopsy"]),
                 has_histopathology=value(dd["histopathology"]), has_annotations=value(any(t.startswith("annot_") for t in file_groups)),
                 has_birads_both=value(len(bs) == 2), has_density_both=value(len(ds) == 2),
                 file_formats=value(sorted({f["mime_type"] for f in session_files if f["mime_type"]})))
        required = {"consent": pilot or r["has_consent"] == "1", "questionnaire": r["has_questionnaire"] == "1", "all_4_views": dd["four_views"],
                    "birads_right": bool(r["birads_right"]), "birads_left": bool(r["birads_left"]), "density_right": bool(r["density_right"]), "density_left": bool(r["density_left"])}
        r["is_complete_datapoint"] = value(all(required.values()))
        r["missing_components"] = value([c for c, ok in required.items() if not ok])
        equipment = machines[hid]
        for dest, source in (("mammo_machine", "machine"), ("mammo_make", "make"), ("mammo_technology", "technology")):
            values = list(dict.fromkeys(value(m.get(source)) for m in equipment if m.get(source)))
            r[dest] = values[0] if len(values) == 1 else value(values) if values else ""
        r["n_machines_at_hospital"] = value(sum(int(m.get("no_of_machines") or 0) for m in equipment)) if equipment else ""
        uploaders = sorted({f["upload_clinic_id"] for f in session_files if f["upload_clinic_id"]})
        r["upload_clinic_id"] = uploaders[0] if len(uploaders) == 1 else value(uploaders) if uploaders else ""
        r["upload_clinic_mismatch"] = value(any(u != hid for u in uploaders)) if hid and uploaders else ""
        if not pilot: warnings.append("Portal raw answers retained; risk fields without a verified equivalent remain blank. Optional model encodings are not generated.")
        if not hid: warnings.append("Unmatched pilot hospitals require review")
        master.append(r)
        files.extend(session_files)
    subjects = group([r for r in master if r["subject_key"]], "subject_key")
    for r in master:
        linked = sorted(subjects.get(r["subject_key"], []), key=lambda x: (x["session_start_at"], x["session_id"]))
        r.update(n_sessions_for_subject=value(len(linked)) if linked else "", session_sequence_for_subject=value(next((i for i, x in enumerate(linked, 1) if x is r), "")),
                 is_latest_session_for_subject=value(bool(linked and linked[-1] is r)) if linked else "",
                 has_portal_record=value(any(x["data_source"] == "portal" for x in linked)) if linked else "",
                 has_pilot_record=value(any(x["data_source"] == "pilot" for x in linked)) if linked else "")
    pd.validate(master, files)
    included = {r["session_id"] for r in master}
    expected_attachments = sum(len(attachments[value(a["id"])]) for sid in included for a in assessments[sid])
    if len(files) != expected_attachments + sum(r["has_consent"] == "1" for r in master): raise ValueError("File reconciliation failed")
    report = {"source_sessions": len(sessions), "included_sessions": len(master), "excluded_sessions": excluded,
              "included_pilot_sessions": sum(r["is_pilot"] == "1" for r in master), "attachment_rows": expected_attachments,
              "assessed_sessions": sum(r["has_assessment"] == "1" for r in master), "warnings": sorted(set(warnings)),
              "excluded_orphan_pilot_sessions": len(orphans), "orphan_pilot_institutes": orphan_institutes,
              "unmatched_hospital_sessions": sum(not r["hospital_id"] for r in master),
              "unlinked_sessions": sum(not r["subject_key"] for r in master), "source_tables_read_only": True}
    return master, files, report, built_at


def csv_text(rows, required):
    buf = io.StringIO(newline="")
    cols = list(dict.fromkeys(["session_id"] + sorted(required - {"session_id"}) + [k for r in rows for k in r]))
    w = csv.DictWriter(buf, fieldnames=cols)
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def publish(master, files, report, built_at, destination, version=VERSION):
    """Write immutable pair first; replace current.json only after both uploads succeed."""
    pd.validate(master, files)
    build_id = datetime.now(IST).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8]
    base = destination.rstrip("/")
    folder = f"{base}/builds/{build_id}"
    bodies = {"master": csv_text(master, pd.REQUIRED_MASTER), "files": csv_text(files, pd.REQUIRED_FILES)}
    paths = {key: f"{folder}/prospective_{key}.csv" for key in bodies}
    manifest = {"schema_version": 1, "built_at": built_at, "version": version, "rows": len(master), "files": len(files),
                "validation": report, **{f"{key}_uri": path for key, path in paths.items()},
                **{f"{key}_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest() for key, body in bodies.items()}}
    def write(uri, body):
        if uri.startswith("gs://"):
            from google.cloud import storage
            bucket, obj = uri[5:].split("/", 1)
            storage.Client().bucket(bucket).blob(obj).upload_from_string(body.encode("utf-8"), content_type="application/json" if uri.endswith(".json") else "text/csv")
        else:
            path = Path(uri.removeprefix("file://"))
            path.parent.mkdir(parents=True, exist_ok=True)
            temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
            temp.write_bytes(body.encode("utf-8"))
            os.replace(temp, path)
    for key, body in bodies.items(): write(paths[key], body)
    write(f"{folder}/manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    write(f"{base}/current.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    return f"{base}/current.json"
