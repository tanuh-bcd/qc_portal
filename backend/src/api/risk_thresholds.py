from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..db.session import get_db

router = APIRouter()


@router.get("/")
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