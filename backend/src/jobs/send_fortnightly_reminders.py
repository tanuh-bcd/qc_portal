import argparse
import logging
from datetime import date

from ..core.config import settings
from ..db.session import QuestionnaireSessionLocal, SessionLocal
from ..services.reminder_reports import is_delivery_disabled, is_delivery_paused, run_reminders


def parse_args():
    parser = argparse.ArgumentParser(description="Send PinkShield AI fortnightly hospital updates")
    parser.add_argument("--dry-run", action="store_true", help="Calculate and log reports without sending email")
    parser.add_argument("--force", action="store_true", help="Ignore the 14-day due check")
    parser.add_argument("--hospital-id", help="Restrict the run to one hospital")
    parser.add_argument("--report-date", type=date.fromisoformat, help="Override report date (YYYY-MM-DD)")
    return parser.parse_args()


def main():
    logging.basicConfig(level=logging.INFO)
    args = parse_args()
    if not settings.REMINDER_EMAIL_ENABLED and not args.dry_run:
        raise SystemExit("Reminder emails are disabled. Set REMINDER_EMAIL_ENABLED=true after approval.")

    db = SessionLocal()
    questionnaire_db = QuestionnaireSessionLocal()
    try:
        if is_delivery_disabled(db) and not args.dry_run:
            raise SystemExit("Reminder emails were disabled by an authorized operator.")
        if is_delivery_paused(db) and not args.dry_run:
            raise SystemExit("Reminder emails are paused by an authorized operator.")
        results = run_reminders(
            db,
            questionnaire_db,
            report_date=args.report_date,
            hospital_id=args.hospital_id,
            dry_run=args.dry_run,
            force=args.force,
        )
        for result in results:
            print(
                f"{result.report_type}:{result.hospital_id or 'all'} -> "
                f"{result.recipient_email}: {result.status}; "
                f"lifetime_data_points={result.lifetime_data_points}; "
                f"data_points={result.data_points}; "
                f"assessments={result.assessments_submitted}; "
                f"pending={result.pending_submissions}"
            )
        print(f"Processed {len(results)} reminder delivery attempt(s).")
        if any(result.status == "failed" for result in results):
            raise SystemExit("One or more reminder deliveries failed.")
    finally:
        questionnaire_db.close()
        db.close()


if __name__ == "__main__":
    main()
