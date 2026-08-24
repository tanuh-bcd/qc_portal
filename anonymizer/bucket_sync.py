"""
Bucket Sync — anonymize and copy files from source GCS bucket to anonymized bucket.

Usage:
    python3 anonymizer/bucket_sync.py --dry-run
    python3 anonymizer/bucket_sync.py --clinic clinic_00002 --limit 5
    python3 anonymizer/bucket_sync.py
    python3 anonymizer/bucket_sync.py --help
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import signal
import sys
import time
from pathlib import Path

from google.cloud import storage

from bcd_anonymizer import anonymize_file, AnonymizationResult, FileCategory

SRC_BUCKET = "breast-cancer-image-dataset"
DST_BUCKET = "breast-cancer-image-dataset-anonymized"
SRC_PREFIX = "tanuh-data-capture/"
TEMP_DIR = Path("/tmp/bcd_anon_sync")
REPORT_PATH = Path(__file__).parent / "sync_report.csv"

logger = logging.getLogger("bucket_sync")

_interrupted = False


def _handle_sigint(sig, frame):
    global _interrupted
    _interrupted = True
    print("\n\n*** Ctrl+C received — finishing current file, then stopping ***\n")


def get_storage_client() -> storage.Client:
    sa_key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if sa_key and Path(sa_key).exists():
        return storage.Client.from_service_account_json(sa_key)
    return storage.Client()


def list_blobs(client: storage.Client, bucket_name: str, prefix: str) -> dict[str, int]:
    bucket = client.bucket(bucket_name)
    blobs = {}
    for blob in bucket.list_blobs(prefix=prefix):
        if blob.name.endswith("/"):
            continue
        blobs[blob.name] = blob.size or 0
    return blobs


def extract_subject_id(blob_path: str) -> str:
    parts = blob_path.split("/")
    if len(parts) >= 3:
        return parts[2]
    return "ANONYMOUS"


def sync_blob(
    client: storage.Client,
    blob_path: str,
    blob_size: int,
    temp_dir: Path,
) -> dict:
    t0 = time.time()
    result = {
        "blob_path": blob_path,
        "category": "",
        "success": False,
        "error": None,
        "copied_unanonymized": False,
        "size_before": blob_size,
        "size_after": 0,
        "duration_s": 0,
    }

    subject_id = extract_subject_id(blob_path)
    filename = Path(blob_path).name
    temp_input = temp_dir / f"in_{filename}"
    temp_output = temp_dir / f"out_{filename}"

    try:
        src_bucket = client.bucket(SRC_BUCKET)
        src_blob = src_bucket.blob(blob_path)
        src_blob.download_to_filename(str(temp_input))
    except Exception as e:
        result["error"] = f"Download failed: {e}"
        result["duration_s"] = round(time.time() - t0, 2)
        _cleanup(temp_input, temp_output)
        return result

    try:
        anon_result: AnonymizationResult = anonymize_file(
            temp_input, temp_output, subject_id=subject_id
        )
        result["category"] = anon_result.category.value
        result["success"] = anon_result.success
        result["error"] = anon_result.error
        result["copied_unanonymized"] = anon_result.copied_unanonymized
        result["size_before"] = anon_result.file_size_before
        result["size_after"] = anon_result.file_size_after
    except Exception as e:
        result["error"] = f"Anonymization crashed: {e}"
        result["duration_s"] = round(time.time() - t0, 2)
        _cleanup(temp_input, temp_output)
        return result

    if not anon_result.success and anon_result.copied_unanonymized:
        result["error"] = anon_result.error or "Anonymization failed"
        result["duration_s"] = round(time.time() - t0, 2)
        _cleanup(temp_input, temp_output)
        return result

    upload_source = temp_output if temp_output.exists() else None
    if upload_source is None and anon_result.success:
        result["error"] = "Anonymizer reported success but output file missing"
        result["success"] = False
        result["duration_s"] = round(time.time() - t0, 2)
        _cleanup(temp_input, temp_output)
        return result

    if upload_source and upload_source.exists():
        try:
            dst_bucket = client.bucket(DST_BUCKET)
            dst_blob = dst_bucket.blob(blob_path)
            dst_blob.upload_from_filename(str(upload_source))
            result["size_after"] = upload_source.stat().st_size
        except Exception as e:
            result["error"] = f"Upload failed: {e}"
            result["success"] = False

    result["duration_s"] = round(time.time() - t0, 2)
    _cleanup(temp_input, temp_output)
    return result


def _cleanup(*paths):
    for p in paths:
        try:
            if p and p.exists():
                p.unlink()
        except Exception:
            pass


def _format_size(n: int) -> str:
    if n >= 1_073_741_824:
        return f"{n / 1_073_741_824:.1f}GB"
    if n >= 1_048_576:
        return f"{n / 1_048_576:.1f}MB"
    if n >= 1024:
        return f"{n / 1024:.1f}KB"
    return f"{n}B"


def run_sync(
    dry_run: bool = False,
    clinic_filter: str | None = None,
    limit: int | None = None,
):
    global _interrupted
    signal.signal(signal.SIGINT, _handle_sigint)

    client = get_storage_client()

    print(f"Source: gs://{SRC_BUCKET}/{SRC_PREFIX}")
    print(f"Dest:   gs://{DST_BUCKET}/{SRC_PREFIX}")
    print()

    print("Listing source blobs...")
    src_blobs = list_blobs(client, SRC_BUCKET, SRC_PREFIX)
    print(f"  Source: {len(src_blobs)} files, {_format_size(sum(src_blobs.values()))}")

    print("Listing dest blobs...")
    dst_blobs = list_blobs(client, DST_BUCKET, SRC_PREFIX)
    print(f"  Dest:   {len(dst_blobs)} files (already synced)")

    pending = {k: v for k, v in src_blobs.items() if k not in dst_blobs}

    if clinic_filter:
        pending = {
            k: v for k, v in pending.items()
            if f"/{clinic_filter}/" in k
        }
        print(f"  Filtered to clinic: {clinic_filter}")

    if limit and len(pending) > limit:
        limited_keys = sorted(pending.keys())[:limit]
        pending = {k: pending[k] for k in limited_keys}
        print(f"  Limited to: {limit} files")

    total_pending = len(pending)
    total_size = sum(pending.values())
    print(f"\n  Pending: {total_pending} files, {_format_size(total_size)}")

    if dry_run:
        print("\n--- DRY RUN — listing pending files ---\n")
        for i, (path, size) in enumerate(sorted(pending.items()), 1):
            ext = Path(path).suffix.lower()
            print(f"  [{i:4d}] {path}  ({_format_size(size)}, {ext})")
        print(f"\n  Total: {total_pending} files, {_format_size(total_size)}")
        return

    if total_pending == 0:
        print("\nAll files already synced. Nothing to do.")
        return

    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    succeeded = 0
    failed = 0
    skipped = 0
    unanonymized = 0
    bytes_processed = 0
    results = []
    sync_start = time.time()

    sorted_pending = sorted(pending.items())

    report_file = open(REPORT_PATH, "w", newline="")
    writer = csv.DictWriter(
        report_file,
        fieldnames=[
            "blob_path", "category", "success", "error",
            "copied_unanonymized", "size_before", "size_after", "duration_s",
        ],
    )
    writer.writeheader()

    try:
        for i, (blob_path, blob_size) in enumerate(sorted_pending, 1):
            if _interrupted:
                print(f"\nStopped at file {i}/{total_pending}")
                break

            short_path = blob_path.replace(SRC_PREFIX, "")
            print(
                f"[{i:4d}/{total_pending}] {short_path}  "
                f"({_format_size(blob_size)}) ... ",
                end="",
                flush=True,
            )

            r = sync_blob(client, blob_path, blob_size, TEMP_DIR)
            writer.writerow(r)
            report_file.flush()
            results.append(r)

            if r["copied_unanonymized"]:
                unanonymized += 1

            if r["success"]:
                succeeded += 1
                bytes_processed += r["size_before"]
                tag = "OK"
            else:
                failed += 1
                tag = "FAIL"
                if r.get("error", "").startswith("Skipped"):
                    skipped += 1
                    tag = "SKIP"
                elif r["copied_unanonymized"]:
                    tag = "SKIP_PII"

            cat = r.get("category", "?")
            dur = r.get("duration_s", 0)
            print(f"{tag} [{cat}] ({dur:.1f}s)")

            if r["error"] and tag == "FAIL":
                print(f"         Error: {r['error'][:120]}")

    finally:
        report_file.close()

    elapsed = time.time() - sync_start
    print("\n" + "=" * 70)
    print("SYNC SUMMARY")
    print("=" * 70)
    print(f"  Total files:     {total_pending}")
    print(f"  Succeeded:       {succeeded}")
    print(f"  Failed:          {failed}")
    print(f"  Skipped:         {skipped}")
    print(f"  Copied unanon:   {unanonymized}")
    print(f"  Bytes processed: {_format_size(bytes_processed)}")
    print(f"  Duration:        {elapsed:.0f}s ({elapsed/60:.1f}m)")
    print(f"  Report saved:    {REPORT_PATH}")
    if _interrupted:
        print(f"  *** Interrupted — re-run to resume remaining files ***")
    print("=" * 70)

    if failed > 0:
        print(f"\nFailed files:")
        for r in results:
            if not r["success"]:
                print(f"  {r['blob_path']}: {r['error'][:100]}")

    if unanonymized > 0:
        print(f"\nFiles copied WITHOUT anonymization (may still contain PII):")
        for r in results:
            if r["copied_unanonymized"]:
                print(f"  {r['blob_path']}: {r['error'][:100]}")


def main():
    parser = argparse.ArgumentParser(
        description="Sync and anonymize files from source GCS bucket to anonymized bucket"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="List pending files without processing",
    )
    parser.add_argument(
        "--clinic", type=str, default=None,
        help="Only process a specific clinic (e.g., clinic_00002)",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Process at most N files",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )

    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        sa_key = Path(__file__).parent.parent / "bcd-prototypes-54e0e4ec7ad2.json"
        if sa_key.exists():
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(sa_key)

    run_sync(
        dry_run=args.dry_run,
        clinic_filter=args.clinic,
        limit=args.limit,
    )


if __name__ == "__main__":
    main()
