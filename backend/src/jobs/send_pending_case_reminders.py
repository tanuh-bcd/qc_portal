"""Sends the 3-day pending-cases reminder email to every Mammo Tech/Radiologist
with at least one pending case. Independent of send_fortnightly_reminders.py
(a separate, unrelated feature) — no shared code or tables.

Run manually, or wire into your own cron/systemd/Cloud Scheduler later:
    python -m backend.src.jobs.send_pending_case_reminders --dry-run
"""
import argparse
import logging

from ..db.session import SessionLocal
from ..services.pending_case_reminders import send_due_reminders


def parse_args():
    parser = argparse.ArgumentParser(description="Send QC Portal pending-cases reminder emails")
    parser.add_argument("--dry-run", action="store_true", help="Report who would be emailed without sending or recording anything")
    return parser.parse_args()


def main():
    logging.basicConfig(level=logging.INFO)
    args = parse_args()

    db = SessionLocal()
    try:
        results = send_due_reminders(db, dry_run=args.dry_run)
    finally:
        db.close()

    for r in results:
        print(f"user_id={r['user_id']} email={r['email']} pending={r['pending_count']} "
              f"sent={r['sent']}" + (f" reason={r['reason']}" if r.get("reason") else ""))
    sent_count = sum(1 for r in results if r["sent"])
    print(f"Processed {len(results)} candidate(s), sent {sent_count} email(s).")
    if any(r["reason"] == "send_failed" for r in results):
        raise SystemExit("One or more reminder emails failed to send.")


if __name__ == "__main__":
    main()
