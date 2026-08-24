import logging
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from ..db.session import get_db, get_questionnaire_db
from ..mammogram_service import get_portal_mammogram_dashboard

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/portal-stats")
def get_mammogram_portal_stats(
    app_db: Session = Depends(get_db),
    questionnaire_db: Session = Depends(get_questionnaire_db),
):
    try:
        return get_portal_mammogram_dashboard(app_db, questionnaire_db)
    except Exception as e:
        logger.error(f"Error computing portal mammogram stats: {e}")
        return {
            "totalAssessments": 0,
            "totals": {"imaging_studies": 0, "reports": 0, "total": 0},
            "viewTypeCounts": [],
            "setCompleteness": [],
            "reportCompleteness": [],
            "completionRate": {"viewsUploaded": 0, "totalSubjects": 0, "rate": 0.0},
            "byHospital": [],
            "hospitalTypeBreakdown": [],
            "reportsByHospital": [],
            "biradsByInstituteAndSide": [],
            "error": str(e),
        }