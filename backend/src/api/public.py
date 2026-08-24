import math
import json
import uuid
import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import text
from ..db.session import get_questionnaire_db, get_db
from ..core.config import settings
from ..models.models import ModelWeightsVersionControl, ModelWeights, RiskThresholdsVersionControl, RiskThresholds
from google.cloud import storage
from pydantic import BaseModel
from typing import Any, Dict, Optional

router = APIRouter()

_questionnaire_json_path = Path(__file__).resolve().parent / "questionnaire_en.json"
_QUESTION_TEXT_MAP: Dict[str, str] = {}
if _questionnaire_json_path.exists():
    with open(_questionnaire_json_path, encoding="utf-8") as _f:
        _QUESTION_TEXT_MAP = {k: v.get("question", k) for k, v in json.load(_f).get("questions", {}).items()}


def _get_active_weights(app_db: Session) -> Dict[str, float]:
    active_version = (
        app_db.query(ModelWeightsVersionControl)
        .filter(ModelWeightsVersionControl.is_active == True)
        .first()
    )
    if not active_version:
        raise HTTPException(status_code=500, detail="No active model weights version found")

    rows = (
        app_db.query(ModelWeights)
        .filter(ModelWeights.version_number == active_version.version_number)
        .all()
    )
    return {row.feature_name: float(row.weight_value) for row in rows}


def _get_active_thresholds(app_db: Session):
    active_version = (
        app_db.query(RiskThresholdsVersionControl)
        .filter(RiskThresholdsVersionControl.is_active == True)
        .first()
    )
    if not active_version:
        raise HTTPException(status_code=500, detail="No active risk thresholds version found")

    return (
        app_db.query(RiskThresholds)
        .filter(RiskThresholds.version_number == active_version.version_number)
        .all()
    )

def calculate_snehitha_risk(form_data: dict, weights: Dict[str, float]) -> str:
    age = int(form_data.get("Q1", 0) or 0)
    age_at_menarche = int(form_data.get("Q10", 0) or 0)
    irregular_cycles = 1 if form_data.get("Q12_Current") == "No" else 0
    breastfeeding_24m = 1 if form_data.get("Q17") == "greater than 24 months" else 0
    first_degree_relatives = 1 if form_data.get("Q21") == "First Order (Mother, Sibling, Father)" else 0
    previous_biopsy = 1 if form_data.get("Q40") == "Yes" else 0

    is_nullipara = form_data.get("Q14") == "No"
    age_first_birth_25_29 = form_data.get("Q16") == "25 to 29"
    age_first_birth_gte30 = form_data.get("Q16") == "After 30"

    age_first_live_birth_2529_or_nullipara = 1 if (is_nullipara or age_first_birth_25_29) else 0
    age_first_live_birth_30_or_more = 1 if age_first_birth_gte30 else 0

    logit_p = (
        weights["intercept"]
        + weights["age"] * age
        + weights["age_at_menarche"] * age_at_menarche
        + weights["irregular_cycles"] * irregular_cycles
        + weights["breastfeeding_24m"] * breastfeeding_24m
        + weights["first_degree_relatives"] * first_degree_relatives
        + weights["previous_biopsy"] * previous_biopsy
        + weights["age_first_live_birth_2529_or_nullipara"] * age_first_live_birth_2529_or_nullipara
        + weights["age_first_live_birth_30_or_more"] * age_first_live_birth_30_or_more
    )

    probability = 1 / (1 + math.exp(-logit_p))
    risk_percentage = round(probability * 100, 2)
    if math.isnan(risk_percentage):
        risk_percentage = 0.00
    return str(risk_percentage)


def determine_risk_category(risk_decimal: float, thresholds) -> str:
    for t in thresholds:
        lo = float(t.min_percentage) if t.min_percentage is not None else float("-inf")
        hi = float(t.max_percentage) if t.max_percentage is not None else float("inf")
        if lo <= risk_decimal < hi:
            return t.risk_category
    return "Unknown"


@router.post("/session/start")
def start_session(request: Request, db: Session = Depends(get_questionnaire_db)):
    session_id = str(uuid.uuid4())
    ip_address = request.client.host if request.client else "unknown"
    now = datetime.datetime.utcnow()

    try:
        db.execute(
            text("INSERT INTO session_table (session_id, ip_address, session_start_time) VALUES (:sid, :ip, :ts)"),
            {"sid": session_id, "ip": ip_address, "ts": now},
        )
        db.commit()
        return {"success": True, "sessionId": session_id}
    except Exception as e:
        db.rollback()
        print(f"Error starting session: {e}")
        raise HTTPException(status_code=500, detail="Could not start session. Please try again.")


@router.post("/session/{session_id}/consent")
async def upload_public_consent(
    session_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_questionnaire_db)
):
    session = db.execute(
        text("SELECT session_id FROM session_table WHERE session_id = :sid"),
        {"sid": session_id}
    ).fetchone()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    content = await file.read()
    extension = file.filename.rsplit('.', 1)[-1] if '.' in file.filename else 'jpg'
    upload_date = datetime.datetime.utcnow().strftime("%Y%m%d")
    blob_name = f"tanuh-data-capture/consent/{session_id}_consent_{upload_date}.{extension}"

    client = storage.Client()

    bucket = client.bucket(settings.GCP_STORAGE_BUCKET)
    blob = bucket.blob(blob_name)
    blob.upload_from_string(content, content_type=file.content_type or "application/octet-stream")
    gcs_url = f"gs://{settings.GCP_STORAGE_BUCKET}/{blob_name}"

    db.execute(
        text("UPDATE session_table SET consent_url = :url WHERE session_id = :sid"),
        {"url": gcs_url, "sid": session_id},
    )
    db.commit()

    return {"success": True, "consent_url": gcs_url}


class SubmitPayload(BaseModel):
    sessionId: str
    formDataEn: Dict[str, Any]


@router.post("/submit")
def submit_questionnaire(
    payload: SubmitPayload,
    db: Session = Depends(get_questionnaire_db),
    app_db: Session = Depends(get_db),
):
    session_id = payload.sessionId
    form_data_en = payload.formDataEn

    if not session_id or not form_data_en:
        raise HTTPException(status_code=400, detail="Session ID and form data are required.")

    session_row = db.execute(
        text("SELECT session_id FROM session_table WHERE session_id = :sid"),
        {"sid": session_id},
    ).fetchone()
    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found. Please start a new questionnaire.")

    try:
        weights = _get_active_weights(app_db)
        thresholds = _get_active_thresholds(app_db)
        risk_percentage = calculate_snehitha_risk(form_data_en, weights)

        now = datetime.datetime.utcnow()
        for key, value in form_data_en.items():
            data_id = str(uuid.uuid4())
            answer = ", ".join(value) if isinstance(value, list) else str(value)
            question_text = _QUESTION_TEXT_MAP.get(key, key)
            db.execute(
                text(
                    "INSERT INTO session_data_table (session_data_id, session_id, question, answer, created_at) "
                    "VALUES (:did, :sid, :q, :a, :ts)"
                ),
                {"did": data_id, "sid": session_id, "q": question_text, "a": answer, "ts": now},
            )
            now = now + datetime.timedelta(seconds=1)

        risk_pct_float = float(risk_percentage)
        risk_decimal = round(risk_pct_float / 100, 4)
        risk_cat = determine_risk_category(risk_decimal, thresholds)

        db.execute(
            text(
                "UPDATE session_table SET session_end_time = :end, snehita_lifetime_risk = :risk, risk_category = :cat WHERE session_id = :sid"
            ),
            {"end": datetime.datetime.utcnow(), "risk": str(risk_decimal), "cat": risk_cat, "sid": session_id},
        )
        db.commit()

        return {"success": True, "message": "Questionnaire submitted successfully!", "riskPercentage": risk_percentage}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error submitting questionnaire for session {session_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail="Could not save your responses. Please try submitting again.",
        )