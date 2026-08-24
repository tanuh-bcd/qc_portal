import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db.session import get_db
from .auth import get_current_user  # TODO: swap for an admin-only dependency if you have one

router = APIRouter()


@router.get("/", response_model=schemas.ModelWeightsVersionResponse)
def get_active_model_weights(db: Session = Depends(get_db)):
    """UI: fetch the currently active version's weights, used by riskUtils.js
    to compute the PinkShieldAI lifetime risk score dynamically."""
    active_version = (
        db.query(models.ModelWeightsVersionControl)
        .filter(models.ModelWeightsVersionControl.is_active == True)
        .first()
    )
    if not active_version:
        raise HTTPException(status_code=404, detail="No active model weights version found")

    weights = (
        db.query(models.ModelWeights)
        .filter(models.ModelWeights.version_number == active_version.version_number)
        .all()
    )
    active_version.weights = weights  # attach for the response_model to serialize
    return active_version


@router.post("/versions", response_model=schemas.ModelWeightsVersionResponse, status_code=201)
def create_and_promote_version(
    payload: schemas.ModelWeightsVersionCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Admin: register a new weights version, insert its rows, and promote it as
    active in one transaction. Prior versions' rows are never touched (append-only)."""
    if not payload.weights:
        raise HTTPException(status_code=400, detail="At least one weight is required")

    max_version = db.query(func.max(models.ModelWeightsVersionControl.version_number)).scalar() or 0
    new_version_number = max_version + 1

    new_version = models.ModelWeightsVersionControl(version_number=new_version_number, is_active=False)
    db.add(new_version)
    db.flush()

    for item in payload.weights:
        db.add(models.ModelWeights(
            feature_name=item.feature_name,
            weight_value=item.weight_value,
            version_number=new_version_number,
        ))

    current_active = (
        db.query(models.ModelWeightsVersionControl)
        .filter(models.ModelWeightsVersionControl.is_active == True)
        .first()
    )
    now = datetime.datetime.utcnow()
    if current_active:
        current_active.is_active = False
        current_active.ended_at = now

    new_version.is_active = True
    new_version.started_at = now

    db.commit()
    db.refresh(new_version)

    new_version.weights = (
        db.query(models.ModelWeights)
        .filter(models.ModelWeights.version_number == new_version_number)
        .all()
    )
    return new_version


@router.get("/config-check")
def get_active_risk_model_config(db: Session = Depends(get_db)):
    """Debug/check endpoint: returns the active model_weights AND active
    risk_thresholds together, exactly as the calculation would read them.
    Use this to confirm the latest promoted version is actually live."""

    weights_version = (
        db.query(models.ModelWeightsVersionControl)
        .filter(models.ModelWeightsVersionControl.is_active == True)
        .first()
    )
    if not weights_version:
        raise HTTPException(status_code=404, detail="No active model weights version found")

    weight_rows = (
        db.query(models.ModelWeights)
        .filter(models.ModelWeights.version_number == weights_version.version_number)
        .all()
    )

    thresholds_version = (
        db.query(models.RiskThresholdsVersionControl)
        .filter(models.RiskThresholdsVersionControl.is_active == True)
        .first()
    )
    if not thresholds_version:
        raise HTTPException(status_code=404, detail="No active risk thresholds version found")

    threshold_rows = (
        db.query(models.RiskThresholds)
        .filter(models.RiskThresholds.version_number == thresholds_version.version_number)
        .all()
    )

    return {
        "weights_version": weights_version.version_number,
        "weights_started_at": weights_version.started_at,
        "weights": {row.feature_name: row.weight_value for row in weight_rows},
        "thresholds_version": thresholds_version.version_number,
        "thresholds_started_at": thresholds_version.started_at,
        "thresholds": [
            {
                "risk_category": row.risk_category,
                "min_percentage": row.min_percentage,
                "max_percentage": row.max_percentage,
            }
            for row in threshold_rows
        ],
    }