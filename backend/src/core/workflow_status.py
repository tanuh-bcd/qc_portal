"""Derives the richer Mammo Tech / Radiologist workflow statuses from the
existing qc_assignments.qc_status ('Pending'/'Completed' only) and a small
JSON payload stashed in qc_review_notes, so no schema/enum change is needed
to support Accepted/Rejected/In-Progress states."""
import json


def parse_notes(raw):
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def mammo_tech_display_status(assignment) -> str:
    if assignment is None:
        return "Unassigned"
    if assignment.qc_status != "Completed":
        return "Pending"
    meta = parse_notes(assignment.qc_review_notes)
    return "Accepted" if meta.get("quality_accepted") else "Rejected"


def radiologist_display_status(assignment) -> str:
    if assignment is None:
        return "Unassigned"
    if assignment.qc_status == "Completed":
        return "Completed"
    meta = parse_notes(assignment.qc_review_notes)
    if meta.get("left") or meta.get("right"):
        return "In-Progress"
    return "Pending"
