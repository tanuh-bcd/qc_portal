"""Make a second test case from DICOMs you already have, so the portal does not reject it as a duplicate.

The portal rejects a case whose four images are byte-identical to a stored one. This copies every .dcm in
SRC, changes only the harmless ImageComments tag, and writes the copies to DEST (same file names).
Usage: python make_test_case_variant.py SRC_DICOM_FOLDER DEST_DICOM_FOLDER "text for ImageComments"
"""
import sys
from pathlib import Path

import pydicom


def main(src: Path, dest: Path, tag: str):
    dest.mkdir(parents=True, exist_ok=True)
    files = [p for p in src.rglob("*") if p.is_file() and p.suffix.lower() == ".dcm"]
    if not files:
        sys.exit(f"No .dcm files found under {src}")
    for p in files:
        ds = pydicom.dcmread(p)
        ds.ImageComments = tag
        ds.save_as(dest / p.name)
        print("wrote", dest / p.name)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
