"""Run from the folder that contains 'backend': python3 -m backend.tools.build_prospective --output /data/prospective

Set PROSPECTIVE_QUESTIONNAIRE_DATABASE_URL, PROSPECTIVE_CLINICAL_DATABASE_URL, PROSPECTIVE_PILOT_DATABASE_URL (read-only use).
"""
import argparse
import os
import sys

from sqlalchemy import create_engine
from backend.src.services.prospective_build import build, extract, publish, VERSION


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Local folder or gs://bucket/prefix")
    parser.add_argument("--version", default=VERSION)
    args = parser.parse_args()
    engines = {}
    try:
        for source in ("questionnaire", "clinical", "pilot"):
            name = f"PROSPECTIVE_{source.upper()}_DATABASE_URL"
            uri = os.environ.get(name)
            if not uri:
                raise ValueError(f"Set {name} to a read-only source database URL")
            engines[source] = create_engine(uri, pool_pre_ping=True, connect_args={"connect_timeout": 15} if uri.startswith("mysql") else {})
        rows, files, report, built_at = build(extract(engines), args.version)
        path = publish(rows, files, report, built_at, args.output, args.version)
        print(f"Published {len(rows)} sessions and {len(files)} files. Manifest: {path}")
        for w in report.get("warnings", []):
            print("Note:", w)
        print("Left out:", report.get("excluded_sessions", 0), "empty sessions,", report.get("excluded_orphan_pilot_sessions", 0), "pilot rows without a session")
    except Exception as exc:
        # Show the reason, but never the connection URL (it holds the password). Checks and database errors carry no credentials.
        reason = getattr(exc, "orig", None) or (exc if isinstance(exc, ValueError) else type(exc).__name__)
        print(f"Build failed ({type(exc).__name__}): {reason}", file=sys.stderr)
        print("No new dataset was activated.", file=sys.stderr)
        return 1
    finally:
        for engine in engines.values():
            engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
