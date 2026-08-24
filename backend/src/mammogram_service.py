import logging
from collections import Counter, defaultdict
from sqlalchemy.orm import Session
from sqlalchemy import func, case, text
from .models.models import Attachment, DoctorAssessment, Hospital, PatientSession, Machine

logger = logging.getLogger(__name__)

MAMMOGRAM_VIEW_TYPES = [
    'mammo_cc_left',
    'mammo_cc_right',
    'mammo_mlo_left',
    'mammo_mlo_right',
]

REPORT_FILE_TYPES = [
    'mammo_reading',
    'us_reading',
]

EXCLUDED_HOSPITAL_NAMES = ('Test', 'Tanuh Foundation')
INSTITUTE_QUESTIONS = ('Institute Name', 'Institute Name:', 'Enter the Hospital ID(If any, else leave):', 'Q45')

VALID_BIRADS = {'0', '1', '2', '3', '4', '5'}


def _get_institute_filter():
    return """
    JOIN (
        SELECT session_id, MAX(answer) as answer
        FROM session_data_table
        WHERE question IN :inst_questions
          AND answer IN :valid_names
        GROUP BY session_id
    ) sd_inst ON s.session_id = sd_inst.session_id
    """

def get_view_type_counts(db: Session) -> dict:
    view_counts = {}
    for view_type in MAMMOGRAM_VIEW_TYPES:
        count = db.query(func.count(Attachment.id)).filter(
            Attachment.file_type == view_type
        ).scalar() or 0
        view_name = view_type.replace('mammo_', '').upper()
        view_counts[view_name] = count

    return view_counts


def get_total_subjects_count(db: Session, questionnaire_db: Session) -> int:
    hospital_rows = db.query(Hospital.name).filter(
        ~Hospital.name.in_(list(EXCLUDED_HOSPITAL_NAMES))
    ).all()
    valid_hospitals = [h.name for h in hospital_rows]
    if not valid_hospitals:
        return 0

    inst_filter = _get_institute_filter()
    params = {"inst_questions": INSTITUTE_QUESTIONS, "valid_names": tuple(valid_hospitals)}

    total_res = questionnaire_db.execute(text(f"""
        SELECT COUNT(DISTINCT s.session_id) as total
        FROM session_table s {inst_filter}
        WHERE s.snehita_lifetime_risk IS NOT NULL
    """), params).fetchone()

    return total_res[0] if total_res else 0


def get_total_mammogram_stats(db: Session, questionnaire_db: Session) -> dict:
    imaging_studies_count = get_total_subjects_count(db, questionnaire_db)

    report_count = db.query(func.count(Attachment.id)).join(
        DoctorAssessment, Attachment.assessment_id == DoctorAssessment.id
    ).join(
        Hospital, DoctorAssessment.hospital_id == Hospital.id
    ).filter(
        Attachment.file_type.in_(REPORT_FILE_TYPES),
        ~Hospital.name.in_(list(EXCLUDED_HOSPITAL_NAMES))
    ).scalar() or 0

    return {
        'imaging_studies': imaging_studies_count,
        'reports': report_count,
        'total': imaging_studies_count + report_count,
    }

def _mammo_view_count_subquery(db: Session):
    return db.query(func.count(Attachment.id)).filter(
        Attachment.assessment_id == DoctorAssessment.id,
        Attachment.file_type.in_(MAMMOGRAM_VIEW_TYPES)
    ).correlate(DoctorAssessment).scalar_subquery()


def get_complete_sets_count(db: Session) -> int:
    subq = _mammo_view_count_subquery(db)
    complete = db.query(func.count(DoctorAssessment.id)).filter(
        subq == len(MAMMOGRAM_VIEW_TYPES)
    ).scalar() or 0

    return complete


def get_partial_sets_count(db: Session) -> int:
    subq = _mammo_view_count_subquery(db)
    partial = db.query(func.count(DoctorAssessment.id)).filter(
        subq.between(1, len(MAMMOGRAM_VIEW_TYPES) - 1)
    ).scalar() or 0

    return partial


def get_report_uploaded_count(db: Session) -> int:

    return db.query(func.count(func.distinct(DoctorAssessment.id))).join(
        Attachment, Attachment.assessment_id == DoctorAssessment.id
    ).join(
        Hospital, DoctorAssessment.hospital_id == Hospital.id
    ).filter(
        Attachment.file_type.in_(REPORT_FILE_TYPES),
        ~Hospital.name.in_(list(EXCLUDED_HOSPITAL_NAMES))
    ).scalar() or 0


def get_report_missing_count(db: Session) -> int:
    total = get_total_assessments_count(db)
    uploaded = get_report_uploaded_count(db)
    return max(total - uploaded, 0)


def get_reports_by_hospital(db: Session) -> list:
    report_count_subq = db.query(func.count(Attachment.id)).join(
        DoctorAssessment, Attachment.assessment_id == DoctorAssessment.id
    ).filter(
        DoctorAssessment.hospital_id == Hospital.id,
        Attachment.file_type.in_(REPORT_FILE_TYPES)
    ).correlate(Hospital).scalar_subquery()

    results = db.query(
        Hospital.id,
        Hospital.name,
        Hospital.short_name,
        report_count_subq.label('report_count'),
    ).filter(
        ~Hospital.name.in_(list(EXCLUDED_HOSPITAL_NAMES))
    ).order_by(
        report_count_subq.desc()
    ).all()

    return [
        {
            'hospital_id': row.id,
            'hospital_name': row.name,
            'short_name': row.short_name or row.name,
            'report_count': row.report_count or 0,
        }
        for row in results
    ]

def get_mammogram_by_hospital(db: Session, questionnaire_db: Session) -> list:
    # --- subject counts from questionnaire_db, keyed by hospital name ---
    hospital_rows = db.query(Hospital.name).filter(
        ~Hospital.name.in_(list(EXCLUDED_HOSPITAL_NAMES))
    ).all()
    valid_hospitals = [h.name for h in hospital_rows]

    subject_counts_by_name = {}
    if valid_hospitals:
        inst_filter = _get_institute_filter()
        params = {"inst_questions": INSTITUTE_QUESTIONS, "valid_names": tuple(valid_hospitals)}
        subj_rows = questionnaire_db.execute(text(f"""
            SELECT sd_inst.answer AS institute, COUNT(DISTINCT s.session_id) AS subjects
            FROM session_table s {inst_filter}
            WHERE s.snehita_lifetime_risk IS NOT NULL
            GROUP BY sd_inst.answer
        """), params).fetchall()
        subject_counts_by_name = {r[0]: int(r[1]) for r in subj_rows}

    # --- everything else stays as-is, from app_db ---
    assessment_count_subq = db.query(func.count(DoctorAssessment.id)).filter(
        DoctorAssessment.hospital_id == Hospital.id
    ).correlate(Hospital).scalar_subquery()

    dicom_count_subq = db.query(func.count(Attachment.id)).join(
        DoctorAssessment, Attachment.assessment_id == DoctorAssessment.id
    ).filter(
        DoctorAssessment.hospital_id == Hospital.id,
        Attachment.file_type.in_(MAMMOGRAM_VIEW_TYPES)
    ).correlate(Hospital).scalar_subquery()

    report_count_subq = db.query(func.count(Attachment.id)).join(
        DoctorAssessment, Attachment.assessment_id == DoctorAssessment.id
    ).filter(
        DoctorAssessment.hospital_id == Hospital.id,
        Attachment.file_type.in_(REPORT_FILE_TYPES)
    ).correlate(Hospital).scalar_subquery()

    results = db.query(
        Hospital.id,
        Hospital.name,
        Hospital.short_name,
        Hospital.state,
        Hospital.type,
        Machine.machine.label('machine_name'),
        Machine.make.label('machine_make'),
        Machine.technology.label('machine_technology'),
        Machine.no_of_machines.label('machine_count'),
        assessment_count_subq.label('assessment_count'),
        dicom_count_subq.label('dicom_count'),
        report_count_subq.label('report_count'),
    ).filter(
        ~Hospital.name.in_(list(EXCLUDED_HOSPITAL_NAMES))
    ).outerjoin(
        Machine, Machine.hospital_id == Hospital.id
    ).order_by(
        assessment_count_subq.desc()
    ).all()

    hospital_data = []
    for row in results:
        hospital_data.append({
            'hospital_name': row.name,
            'short_name': row.short_name or row.name,
            'state': row.state,
            'type': row.type,
            'machines': [{
                'machine_name': row.machine_name,
                'make': row.machine_make,
                'technology': row.machine_technology,
                'machine_count': row.machine_count,
            }] if row.machine_name else [],
            'subject_count': subject_counts_by_name.get(row.name, 0),
            'assessment_count': row.assessment_count or 0,
            'dicom_count': row.dicom_count or 0,
            'report_count': row.report_count or 0,
        })

    return hospital_data
def get_hospital_type_breakdown(db: Session) -> list:
    rows = db.query(
        Hospital.id,
        Hospital.name,
        Hospital.short_name,
        Hospital.state,
        Hospital.type,
    ).filter(
        ~Hospital.name.in_(list(EXCLUDED_HOSPITAL_NAMES))
    ).all()

    groups = {'cr': [], 'dr': [], 'unassigned': []}

    for row in rows:
        key = (row.type or '').lower()
        if key not in ('cr', 'dr'):
            key = 'unassigned'
        groups[key].append({
            'hospital_id': row.id,
            'hospital_name': row.name,
            'short_name': row.short_name or row.name,
            'state': row.state,
        })

    labels = {'cr': 'CR', 'dr': 'DR', 'unassigned': 'Unassigned'}

    breakdown = []
    for key in ('cr', 'dr', 'unassigned'):
        if groups[key]:  # skip empty "unassigned" bucket if every hospital is tagged
            breakdown.append({
                'name': labels[key],
                'value': len(groups[key]),
                'hospitals': groups[key],
            })

    return breakdown

def get_total_assessments_count(db: Session) -> int:
    return db.query(func.count(DoctorAssessment.id)).join(
        Hospital, DoctorAssessment.hospital_id == Hospital.id
    ).filter(
        ~Hospital.name.in_(list(EXCLUDED_HOSPITAL_NAMES))
    ).scalar() or 0


def get_total_views_uploaded_count(db: Session) -> int:
    return db.query(func.count(Attachment.id)).filter(
        Attachment.file_type == 'mammo_cc_left'
    ).scalar() or 0


def get_completion_rate(total_subjects: int, reports_count: int) -> dict:
    rate = round((reports_count / total_subjects) * 100, 2) if total_subjects else 0.0

    return {
        "reportsUploaded": reports_count,
        "totalSubjects": total_subjects,
        "rate": rate,
    }

def get_birads_by_institute_and_side(db: Session) -> dict:
    ranked = db.query(
        DoctorAssessment.id.label('assessment_id'),
        DoctorAssessment.patient_session_id,
        DoctorAssessment.mammo_birads,
        DoctorAssessment.mammo_density,
        func.row_number().over(
            partition_by=DoctorAssessment.patient_session_id,
            order_by=DoctorAssessment.created_at.desc()
        ).label('rn')
    ).subquery()

    image_count_subq = db.query(func.count(Attachment.id)).filter(
        Attachment.assessment_id == ranked.c.assessment_id,
        Attachment.file_type.in_(MAMMOGRAM_VIEW_TYPES)
    ).correlate(ranked).scalar_subquery()

    rows = db.query(
        ranked.c.patient_session_id,
        ranked.c.mammo_birads,
        ranked.c.mammo_density,
        image_count_subq.label('image_count'),
    ).filter(ranked.c.rn == 1).all()

    birads = defaultdict(lambda: {"subjects": set(), "images": 0})
    density = defaultdict(lambda: {"subjects": set(), "images": 0})

    for patient_id, birads_value, density_value, image_count in rows:
        image_count = image_count or 0

        if birads_value:
            birads[str(birads_value)]["subjects"].add(patient_id)
            birads[str(birads_value)]["images"] += image_count

        if density_value:
            density[str(density_value)]["subjects"].add(patient_id)
            density[str(density_value)]["images"] += image_count

    return {
        "biradsCategory": [
            {
                "category": category,
                "subjects": len(data["subjects"]),
                "images": data["images"],
            }
            for category, data in sorted(birads.items())
        ],
        "biradsDensity": [
            {
                "density": density_name,
                "subjects": len(data["subjects"]),
                "images": data["images"],
            }
            for density_name, data in sorted(density.items())
        ],
    }


def get_portal_mammogram_dashboard(db: Session, questionnaire_db: Session) -> dict:
    total_assessments = get_total_assessments_count(db)
    complete_sets = get_complete_sets_count(db)
    partial_sets = get_partial_sets_count(db)
    no_mammogram = max(total_assessments - complete_sets - partial_sets, 0)
    report_uploaded = get_report_uploaded_count(db)
    report_missing = max(total_assessments - report_uploaded, 0)
    view_counts = get_view_type_counts(db)
    totals = get_total_mammogram_stats(db, questionnaire_db)
    by_hospital = get_mammogram_by_hospital(db, questionnaire_db)
    hospital_type_breakdown = get_hospital_type_breakdown(db)
    reports_by_hospital = get_reports_by_hospital(db)
    birads_stats = get_birads_by_institute_and_side(db)

    return {
        "totalAssessments": total_assessments,
        "totals": totals,
        "viewTypeCounts": [
            {"name": name, "count": count} for name, count in view_counts.items()
        ],
        "setCompleteness": [
            {"name": "Complete (4 views)", "value": complete_sets},
            {"name": "Partial (1-3 views)", "value": partial_sets},
            {"name": "No mammogram", "value": no_mammogram},
        ],
        "reportCompleteness": [
            {"name": "Report Uploaded", "value": report_uploaded},
            {"name": "No Report", "value": report_missing},
        ],
        "completionRate": get_completion_rate(totals["imaging_studies"], totals["reports"]),
        "byHospital": by_hospital,
        "hospitalTypeBreakdown": hospital_type_breakdown,
        "reportsByHospital": reports_by_hospital,
        "biradsCategory": birads_stats["biradsCategory"],
        "biradsDensity": birads_stats["biradsDensity"],
    }