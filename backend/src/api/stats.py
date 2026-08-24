import logging
import urllib.request
import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from ..db.session import get_questionnaire_db, get_db
from ..models.models import Hospital

router = APIRouter()
logger = logging.getLogger(__name__)

PINCODE_COORDS = {
    "636007": (11.6687, 78.1543, "Salem"),
    "562160": (12.6324, 77.1836, "Ramanagara"),
    "570004": (12.2959, 76.6479, "Mysuru"),
    "533201": (16.5776, 81.9974, "Amalapuram"),
    "532484": (18.3969, 83.8450, "Srikakulam"),
    "636004": (11.6804, 78.1371, "Salem"),
    "500063": (17.4062, 78.4738, "Hyderabad"),
}

_geocode_cache = {}


def _geocode_pincode(pincode, state=""):
    if pincode in PINCODE_COORDS:
        return PINCODE_COORDS[pincode]
    if pincode in _geocode_cache:
        return _geocode_cache[pincode]
    try:
        query = urllib.request.quote(f"{pincode}, {state}, India" if state else f"{pincode}, India")
        url = f"https://nominatim.openstreetmap.org/search?q={query}&format=json&limit=1&addressdetails=1"
        req = urllib.request.Request(url, headers={"User-Agent": "BCD-Portal/1.0"})
        resp = urllib.request.urlopen(req, timeout=5)
        data = json.loads(resp.read())
        if data:
            addr = data[0].get("address", {})
            city = addr.get("city") or addr.get("town") or addr.get("county") or addr.get("state_district", "")
            result = (float(data[0]["lat"]), float(data[0]["lon"]), city)
            _geocode_cache[pincode] = result
            return result
    except Exception as e:
        logger.warning("Geocode failed for pincode %s: %s", pincode, e)
    return None

INSTITUTE_QUESTIONS = ('Institute Name', 'Institute Name:', 'Enter the Hospital ID(If any, else leave):', 'Q45')
AGE_QUESTIONS = ('What is your current age? (Please enter a number - years)', 'Q1')


def _get_institute_filter(valid_names):
    return f"""
    JOIN (
        SELECT session_id, MAX(answer) as answer
        FROM session_data_table
        WHERE question IN :inst_questions
          AND answer IN :valid_names
        GROUP BY session_id
    ) sd_inst ON s.session_id = sd_inst.session_id
    """

RISK_CASE = """
    SUM(CASE WHEN s.snehita_lifetime_risk < 0.4004 THEN 1 ELSE 0 END) as no_risk,
    SUM(CASE WHEN s.snehita_lifetime_risk >= 0.4004 AND s.snehita_lifetime_risk < 0.574 THEN 1 ELSE 0 END) as low_risk,
    SUM(CASE WHEN s.snehita_lifetime_risk >= 0.574 AND s.snehita_lifetime_risk < 0.795 THEN 1 ELSE 0 END) as moderate_risk,
    SUM(CASE WHEN s.snehita_lifetime_risk >= 0.795 THEN 1 ELSE 0 END) as high_risk
"""


@router.get("/")
def get_stats(db: Session = Depends(get_questionnaire_db), app_db: Session = Depends(get_db)):
    EXCLUDED_NAMES = ('Test', 'Tanuh Foundation')
    hospital_rows = app_db.query(Hospital.name, Hospital.short_name).filter(
        ~Hospital.name.in_(EXCLUDED_NAMES)
    ).all()
    valid_hospitals = [h.name for h in hospital_rows]
    hospital_short_names = {h.name: h.short_name or h.name for h in hospital_rows}
    if not valid_hospitals:
        return {"totalSubjects": 0, "institutionsEmpanelled": 0, "statesCount": 0,
                "riskBins": [], "hospitalBins": [], "ageBins": [], "monthBins": []}

    inst_filter = _get_institute_filter(valid_hospitals)
    params = {"inst_questions": INSTITUTE_QUESTIONS, "valid_names": tuple(valid_hospitals)}

    total_res = db.execute(text(f"""
        SELECT COUNT(DISTINCT s.session_id) as total
        FROM session_table s {inst_filter}
        WHERE s.snehita_lifetime_risk IS NOT NULL
    """), params).fetchone()
    total_subjects = total_res[0] if total_res else 0

    risk_res = db.execute(text(f"""
        SELECT {RISK_CASE}
        FROM session_table s {inst_filter}
        WHERE s.snehita_lifetime_risk IS NOT NULL
    """), params).fetchone()

    risk_bins = [
        {"name": "Baseline Risk", "value": int(risk_res[0] or 0)},
        {"name": "Evident Risk", "value": int(risk_res[1] or 0)},
        {"name": "Significant Risk", "value": int(risk_res[2] or 0)},
        {"name": "High Risk", "value": int(risk_res[3] or 0)},
    ] if risk_res else []

    hosp_rows = db.execute(text(f"""
        SELECT sd_inst.answer as institute,
            SUM(CASE WHEN s.snehita_lifetime_risk < 0.4004 THEN 1 ELSE 0 END) as no_risk,
            SUM(CASE WHEN s.snehita_lifetime_risk >= 0.4004 AND s.snehita_lifetime_risk < 0.574 THEN 1 ELSE 0 END) as low,
            SUM(CASE WHEN s.snehita_lifetime_risk >= 0.574 AND s.snehita_lifetime_risk < 0.795 THEN 1 ELSE 0 END) as moderate,
            SUM(CASE WHEN s.snehita_lifetime_risk >= 0.795 THEN 1 ELSE 0 END) as high
        FROM session_table s {inst_filter}
        WHERE s.snehita_lifetime_risk IS NOT NULL
        GROUP BY sd_inst.answer
    """), params).fetchall()

    hospital_bins = [
        {"name": hospital_short_names.get(r[0], r[0] or "Unknown"), "no_risk": int(r[1] or 0), "low": int(r[2] or 0), "moderate": int(r[3] or 0), "high": int(r[4] or 0)}
        for r in hosp_rows
    ]

    age_rows = db.execute(text(f"""
        SELECT
            CASE
                WHEN CAST(sd_age.answer AS UNSIGNED) BETWEEN 18 AND 29 THEN '18-29'
                WHEN CAST(sd_age.answer AS UNSIGNED) BETWEEN 30 AND 39 THEN '30-39'
                WHEN CAST(sd_age.answer AS UNSIGNED) BETWEEN 40 AND 49 THEN '40-49'
                WHEN CAST(sd_age.answer AS UNSIGNED) BETWEEN 50 AND 59 THEN '50-59'
                WHEN CAST(sd_age.answer AS UNSIGNED) BETWEEN 60 AND 69 THEN '60-69'
                ELSE '70+'
            END as age_group,
            SUM(CASE WHEN s.snehita_lifetime_risk < 0.4004 THEN 1 ELSE 0 END) as no_risk,
            SUM(CASE WHEN s.snehita_lifetime_risk >= 0.4004 AND s.snehita_lifetime_risk < 0.574 THEN 1 ELSE 0 END) as low,
            SUM(CASE WHEN s.snehita_lifetime_risk >= 0.574 AND s.snehita_lifetime_risk < 0.795 THEN 1 ELSE 0 END) as moderate,
            SUM(CASE WHEN s.snehita_lifetime_risk >= 0.795 THEN 1 ELSE 0 END) as high
        FROM session_table s
        JOIN session_data_table sd_age ON s.session_id = sd_age.session_id
        {inst_filter}
        WHERE s.snehita_lifetime_risk IS NOT NULL
          AND sd_age.question IN :age_questions
        GROUP BY age_group
        ORDER BY age_group ASC
    """), {**params, "age_questions": AGE_QUESTIONS}).fetchall()

    age_labels = ['18-29', '30-39', '40-49', '50-59', '60-69', '70+']
    age_map = {r[0]: r for r in age_rows}
    age_bins = [
        {"name": label, "no_risk": int(age_map[label][1] or 0) if label in age_map else 0,
         "low": int(age_map[label][2] or 0) if label in age_map else 0,
         "moderate": int(age_map[label][3] or 0) if label in age_map else 0,
         "high": int(age_map[label][4] or 0) if label in age_map else 0}
        for label in age_labels
    ]

    month_rows = db.execute(text(f"""
        SELECT
            DATE_FORMAT(COALESCE(s.session_end_time, s.session_start_time), '%b %Y') as month_year,
            DATE_FORMAT(COALESCE(s.session_end_time, s.session_start_time), '%Y-%m') as sort_key,
            SUM(CASE WHEN s.snehita_lifetime_risk < 0.4004 THEN 1 ELSE 0 END) as no_risk,
            SUM(CASE WHEN s.snehita_lifetime_risk >= 0.4004 AND s.snehita_lifetime_risk < 0.574 THEN 1 ELSE 0 END) as low,
            SUM(CASE WHEN s.snehita_lifetime_risk >= 0.574 AND s.snehita_lifetime_risk < 0.795 THEN 1 ELSE 0 END) as moderate,
            SUM(CASE WHEN s.snehita_lifetime_risk >= 0.795 THEN 1 ELSE 0 END) as high
        FROM session_table s {inst_filter}
        WHERE s.snehita_lifetime_risk IS NOT NULL
        GROUP BY month_year, sort_key
        ORDER BY sort_key ASC
    """), params).fetchall()

    month_bins = [
        {"name": r[0], "no_risk": int(r[2] or 0), "low": int(r[3] or 0), "moderate": int(r[4] or 0), "high": int(r[5] or 0)}
        for r in month_rows
    ]

    inst_res = app_db.execute(text(
        "SELECT COUNT(*) FROM hospitals WHERE name NOT IN ('Test', 'Tanuh Foundation')"
    )).fetchone()
    institutions_empanelled = inst_res[0] if inst_res else 0

    states_res = app_db.execute(text(
        "SELECT COUNT(DISTINCT state) FROM hospitals WHERE name NOT IN ('Test', 'Tanuh Foundation') AND state IS NOT NULL AND state != ''"
    )).fetchone()
    states_count = states_res[0] if states_res else 0

    return {
        "totalSubjects": total_subjects,
        "institutionsEmpanelled": institutions_empanelled,
        "statesCount": states_count,
        "riskBins": risk_bins,
        "hospitalBins": hospital_bins,
        "ageBins": age_bins,
        "monthBins": month_bins,
    }


@router.get("/hospital-locations")
def get_hospital_locations(
    app_db: Session = Depends(get_db),
    db: Session = Depends(get_questionnaire_db),
):
    EXCLUDED = ("Test", "Tanuh Foundation")
    hospitals = app_db.query(Hospital).filter(~Hospital.name.in_(EXCLUDED)).all()
    valid_names = [h.name for h in hospitals]
    if not valid_names:
        return []

    subject_rows = db.execute(text("""
        SELECT sd.answer AS institute, COUNT(DISTINCT s.session_id) AS subjects
        FROM session_table s
        JOIN session_data_table sd ON s.session_id = sd.session_id
        WHERE sd.question IN :inst_questions
          AND sd.answer IN :valid_names
          AND s.snehita_lifetime_risk IS NOT NULL
        GROUP BY sd.answer
    """), {"inst_questions": INSTITUTE_QUESTIONS, "valid_names": tuple(valid_names)}).fetchall()
    subject_counts = {r[0]: int(r[1]) for r in subject_rows}

    locations = []
    for h in hospitals:
        result = _geocode_pincode(h.pincode or "", h.state or "")
        if not result:
            continue
        city = result[2] if len(result) > 2 else ""
        locations.append({
            "id": h.id,
            "name": h.name,
            "short_name": h.short_name or h.name,
            "city": city,
            "state": h.state or "",
            "latitude": result[0],
            "longitude": result[1],
            "subjects": subject_counts.get(h.name, 0),
        })
    return locations
