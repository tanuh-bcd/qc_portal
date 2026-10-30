"""Prospective study screens: hospitals, sessions, session detail, export. Admin only.

Data comes from the master CSV pair (services/prospective_data.py); nothing here touches the clinical databases.
"""
import csv
import io
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from ..db.session import get_db
from ..services import prospective_data as pd
from .admin import check_admin_role
from .retro import tally as retro_tally

router = APIRouter()


def _data():
    try:
        return pd.load()
    except pd.NotConfigured:
        raise HTTPException(status_code=503, detail="The prospective data source is not configured. Set PROSPECTIVE_MASTER_URI and PROSPECTIVE_FILES_URI to the GCS paths of the master CSVs.")
    except Exception as exc:  # unreadable file, bad CSV
        raise HTTPException(status_code=502, detail=f"Could not read the prospective master CSV: {exc}")


def _filters(q: str, source: str, hospital_id: str, tech: str, birads: str, density: str, complete: bool, latest_only: bool,
             include_test: bool, assessed: bool, quarter: str):
    return dict(q=q, source=source, hospital_id=hospital_id, tech=tech, birads=birads, density=density, complete=complete,
                latest_only=latest_only, include_test=include_test, assessed=assessed, quarter=quarter)


@router.get("/status")
def status(_: dict = Depends(check_admin_role)):
    try:
        d = pd.load()
    except pd.NotConfigured:
        return {"configured": False}
    except Exception as exc:
        return {"configured": True, "ok": False, "error": str(exc)}
    return {"configured": True, "ok": True, "built_at": d["built_at"], "version": d["version"], "rows": len(d["rows"]), "files": d["n_files"], "uri": d["uri"]}


@router.post("/refresh")
def refresh(_: dict = Depends(check_admin_role)):
    pd.reset_cache()
    d = _data()
    return {"rows": len(d["rows"]), "built_at": d["built_at"], "version": d["version"]}


@router.get("/hospitals")
def hospitals(include_test: bool = False, _: dict = Depends(check_admin_role)):
    rows = _data()["rows"]
    return pd.hospitals([r for r in rows if include_test or not pd.flag(r, "is_test")])


@router.get("/sessions")
def sessions(q: str = "", source: str = "", hospital_id: str = "", tech: str = "", birads: str = "", density: str = "",
             complete: bool = False, latest_only: bool = False, include_test: bool = False, assessed: bool = False, quarter: str = "",
             page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), order: str = "desc",
             _: dict = Depends(check_admin_role)):
    rows = pd.filter_rows(_data()["rows"], **_filters(q, source, hospital_id, tech, birads, density, complete, latest_only, include_test, assessed, quarter))
    rows = sorted(rows, key=lambda r: r.get("session_start_at") or "", reverse=order != "asc")
    start = (page - 1) * page_size
    cols = ("session_id", "data_source", "hospital_id", "hospital_short_name", "hospital_name", "subject_id", "session_start_at", "age", "mammo_technology",
            "has_assessment", "birads_right", "birads_left", "density_right", "density_left", "birads_max", "density_max",
            "n_views_present", "has_all_4_views", "is_complete_datapoint", "has_consent", "pilot_risk_class", "snehita_risk_category")
    return {"total": len(rows), "page": page, "stats": pd.stats(rows),
            "items": [{**{c: r.get(c, "") for c in cols}, "technology": r["_tech"]} for r in rows[start:start + page_size]]}


@router.get("/sessions/{session_id}")
def session_detail(session_id: str, _: dict = Depends(check_admin_role)):
    d = _data()
    row = d["by_id"].get(session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        answers = json.loads(row.get("questionnaire_answers_json") or "[]")
    except ValueError:
        answers = []
    clean = {k: v for k, v in row.items() if not k.startswith("_") and k != "questionnaire_answers_json" and v != ""}
    return {"session": clean, "technology": row["_tech"], "machines": pd.machines_of([row]), "answers": answers, "files": d["files"].get(session_id, [])}


@router.get("/export")
def export(kind: str = Query("paths", pattern="^(paths|csv)$"), q: str = "", source: str = "", hospital_id: str = "", tech: str = "",
           birads: str = "", density: str = "", complete: bool = False, latest_only: bool = False, include_test: bool = False,
           assessed: bool = False, quarter: str = "", _: dict = Depends(check_admin_role)):
    """paths: gs:// list of the latest mammogram views of the filtered sessions. csv: the filtered master rows."""
    d = _data()
    rows = pd.filter_rows(d["rows"], **_filters(q, source, hospital_id, tech, birads, density, complete, latest_only, include_test, assessed, quarter))
    if kind == "paths":
        paths = [f["gcs_path"] for r in rows for f in d["files"].get(r["session_id"], [])
                 if f.get("file_category") == "mammogram" and f.get("view") and f.get("is_latest_of_type") == "1"]
        return PlainTextResponse("\n".join(paths) + ("\n" if paths else ""), headers={"Content-Disposition": 'attachment; filename="download_list.txt"'})
    buf = io.StringIO()
    cols = [c for c in (rows[0].keys() if rows else []) if not c.startswith("_")]
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    return PlainTextResponse(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="prospective_filtered.csv"'})


@router.get("/dashboard")
def master_dashboard(db: Session = Depends(get_db), current_user: dict = Depends(check_admin_role)):
    """One payload for the admin Dashboard: prospective summary (from the master CSV) beside the retrospective tally."""
    retro = retro_tally(db=db, current_user=current_user)
    try:
        d = pd.load()
        pros = {"configured": True, "built_at": d["built_at"], "version": d["version"],
                **pd.summary([r for r in d["rows"] if not pd.flag(r, "is_test")]), "test_rows_excluded": sum(pd.flag(r, "is_test") for r in d["rows"])}
    except pd.NotConfigured:
        pros = {"configured": False}
    except Exception as exc:
        pros = {"configured": True, "error": str(exc)}
    return {"prospective": pros, "retrospective": retro}
