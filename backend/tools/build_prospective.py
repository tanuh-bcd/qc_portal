"""Run from the folder that contains 'backend': python3 -m backend.tools.build_prospective --output /data/prospective

Set PROSPECTIVE_QUESTIONNAIRE_DATABASE_URL, PROSPECTIVE_CLINICAL_DATABASE_URL, PROSPECTIVE_PILOT_DATABASE_URL (read-only use).
"""
import argparse
import sys

from backend.src.services.prospective_build import run_build, VERSION


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Local folder or gs://bucket/prefix")
    parser.add_argument("--version", default=VERSION)
    args = parser.parse_args()
    try:
        result = run_build(args.output, args.version)
        print(f"Published {result['rows']} sessions and {result['files']} files. Manifest: {result['manifest']}")
        for w in result["report"].get("warnings", []):
            print("Note:", w)
        print("Left out:", result["report"].get("excluded_sessions", 0), "empty sessions,", result["report"].get("excluded_orphan_pilot_sessions", 0), "pilot rows without a session")
    except Exception as exc:
        # Show the reason, but never the connection URL (it holds the password). Checks and database errors carry no credentials.
        reason = getattr(exc, "orig", None) or (exc if isinstance(exc, ValueError) else type(exc).__name__)
        print(f"Build failed ({type(exc).__name__}): {reason}", file=sys.stderr)
        print("No new dataset was activated.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
