import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from ..db.session import get_db

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/")
def get_risk_categories(db: Session = Depends(get_db)):
    try:
        rows = db.execute(text("""
            SELECT
                rc.id,
                rc.risk_category,
                rc.lifetime_risk_percentage,
                rc.description,
                rc.recommendation,
                rc.version_number,
                rc.display_order
            FROM ai_features.risk_categories rc
            INNER JOIN ai_features.risk_categories_version_control vc
                ON rc.version_number = vc.version_number
            WHERE vc.is_active = 1
            ORDER BY rc.display_order ASC, rc.id ASC
        """)).fetchall()

    except Exception:
        logger.exception("Failed to fetch risk categories")
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch risk categories"
        )

    return [
        {
            "id": row[0],
            "riskCategory": row[1],
            "lifetimeRiskPercentage": row[2],
            "description": row[3],
            "recommendation": row[4],
            "versionNumber": row[5],
            "displayOrder": row[6],
        }
        for row in rows
    ]