"""Retrospective intake: validate uploaded cases and store only those that pass.

A case is a folder holding four DR mammogram DICOMs (LCC, LMLO, RCC, RMLO) and a
PDF report that states BI-RADS 3-6 (breast density is welcome but optional). A JSON
report may sit alongside the PDF and is kept with the case, but a JSON alone is not enough.
Outcomes:

* passed   - every check succeeded; files go to GCS and a qc_retro_cases row is created
* rejected - any check failed; the upload is discarded (never written to GCS) and only
             an audit row with the reasons is kept for the dashboard
"""
import datetime
import gzip
import hashlib
import io
import json
import logging
import os
import re
import shutil
import time
import subprocess
import tempfile
import threading
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pydicom

from ..core.config import settings
from ..models.retro import RetroBatch, RetroCase, RetroDeletedCase, RetroFile, RetroRejection

logger = logging.getLogger(__name__)

STANDARD_VIEWS = ("LCC", "LMLO", "RCC", "RMLO")
ALLOWED_BIRADS = {"3", "4", "5", "6"}
DICOM_EXTENSIONS = {".dcm"}  # compared lower-case, so .DCM counts too
REPORT_EXTENSIONS = {".pdf", ".json"}
# Digital mammography image storage (presentation / processing).
DR_SOP_CLASSES = {"1.2.840.10008.5.1.4.1.1.1.2", "1.2.840.10008.5.1.4.1.1.1.2.1"}
MAX_UNZIPPED_BYTES = 40 * 1024 ** 3
NON_DR_TOKENS = ("tomo", "dbt", "synthetic", "s-view", "c-view")
# Direct identifiers never copied into the header cache shown to admins.
PHI_KEYWORDS = {
    "PatientName", "PatientBirthDate", "PatientAddress", "PatientTelephoneNumbers",
    "OtherPatientNames", "OtherPatientIDs", "ReferringPhysicianName",
    "PerformingPhysicianName", "OperatorsName", "PatientMotherBirthName",
}

RETRO_GCS_PREFIX = os.environ.get("RETRO_GCS_PREFIX", "retrospective/").strip("/") + "/"


def touch_heartbeat(batch_id: int):
    """Mark a batch as alive. Any worker can read this file, so a stuck batch (server restarted mid-run) can be told apart."""
    try:
        d = staging_root() / str(batch_id)
        d.mkdir(parents=True, exist_ok=True)
        (d / ".alive").touch()
    except OSError:
        logger.warning("Could not write the heartbeat for batch %s", batch_id)


def heartbeat_age(batch_id: int) -> Optional[float]:
    """Seconds since the batch last showed activity, or None when there is no heartbeat."""
    try:
        return max(0.0, time.time() - (staging_root() / str(batch_id) / ".alive").stat().st_mtime)
    except OSError:
        return None


def staging_root() -> Path:
    return Path(os.environ.get("RETRO_STAGING_DIR") or Path(tempfile.gettempdir()) / "qc_retro")


# --------------------------------------------------------------------------- #
# Value normalisation
# --------------------------------------------------------------------------- #
ROMAN = {"I": "1", "II": "2", "III": "3", "IV": "4", "V": "5", "VI": "6"}
# value: 4, 4A, 4c, IV, IVc ...  (longest Roman numeral first; must not run into more letters/digits)
_BIRADS_VALUE = r"((?:[0-6]|VI|IV|V|III|II|I)(?:\s?[ABC])?)(?![A-Za-z0-9])"
_SEP = r"[\s:.\-=]*"
BIRADS_PATTERNS = (
    re.compile(r"\bBI\s*-?\s*RADS?\b(?:\s+(?:Assessment|Category|Score|Classification|Grade)){0,3}" + _SEP + _BIRADS_VALUE, re.I),
    re.compile(r"\b(?:left|right)\s+breast\s+category" + _SEP + _BIRADS_VALUE, re.I),
)


def _normalise_text(text: str) -> str:
    """Long dashes, minus signs and non-breaking spaces all become ordinary characters."""
    for ch in "\u2010\u2011\u2012\u2013\u2014\u2015\u2212":
        text = text.replace(ch, "-")
    return text.replace("\u00a0", " ")


def to_birads(token: Any) -> str:
    """'4', '4c', 'IVc', 'BI-RADS 4A' -> '4', '4C', '4C', '4A'. '' if it is not a BI-RADS value."""
    text = re.sub(r"[^0-9A-Za-z]", "", str(token or "").lower().replace("bi-rads", "").replace("birads", "")).upper()
    m = re.fullmatch(r"(VI|IV|V|III|II|I|[0-6])([ABC])?", text)
    if not m:
        return ""
    return ROMAN.get(m.group(1), m.group(1)) + (m.group(2) or "")


DENSITY_PATTERNS = (
    re.compile(r"(?i:\b(?:breast\s+)?(?:density|composition))[^A-Za-z0-9\n]{0,6}(?i:(?:category|type|class|acr)[^A-Za-z0-9\n]{0,6})?\(?([A-D])\)?(?![A-Za-z])"),
    re.compile(r"(?i:\bACR)\s*(?i:(?:category|type|density))?\s*[:\-]?\s*\(?([A-D])\)?(?![A-Za-z])"),
)
DENSITY_WORDS = (
    (re.compile(r"almost\s+entirely\s+fatty|entirely\s+fatty", re.I), "A"),
    (re.compile(r"scattered\s+(?:areas\s+of\s+)?fibroglandular", re.I), "B"),
    (re.compile(r"heterogeneously\s+dense", re.I), "C"),
    (re.compile(r"extremely\s+dense", re.I), "D"),
)


def norm_birads(value: Any) -> str:
    return to_birads(value)


def parent_birads(value: str) -> str:
    return value[:1] if value else ""


def norm_density(value: Any) -> str:
    text = str(value or "").strip()
    m = re.match(r"^\(?([A-Da-d])\)?(?:$|[\s:.\-])", text)
    if m:
        return m.group(1).upper()
    for pattern, letter in DENSITY_WORDS:
        if pattern.search(text):
            return letter
    return ""


def _highest_birads(values: List[str]) -> str:
    values = [v for v in (norm_birads(x) for x in values) if v]
    return max(values, key=lambda v: (int(v[0]), v)) if values else ""


# --------------------------------------------------------------------------- #
# Reports
# --------------------------------------------------------------------------- #
@dataclass
class ReportResult:
    ok: bool = False  # readable and in a usable format
    birads: str = ""
    density: str = ""
    problem: str = ""


def _walk_json(node: Any, found: Dict[str, List[Any]]):
    if isinstance(node, dict):
        for key, value in node.items():
            k = re.sub(r"[^a-z0-9]", "", str(key).lower())
            if isinstance(value, (str, int, float)):
                if "birads" in k:
                    found["birads"].append(value)
                elif "density" in k or "composition" in k:
                    found["density"].append(value)
            _walk_json(value, found)
    elif isinstance(node, list):
        for item in node:
            _walk_json(item, found)


def parse_json_report(path: Path) -> ReportResult:
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return ReportResult(problem=f"{path.name}: not valid JSON")
    if not isinstance(raw, (dict, list)):
        return ReportResult(problem=f"{path.name}: JSON root is not an object")
    found: Dict[str, List[Any]] = {"birads": [], "density": []}
    _walk_json(raw, found)
    birads = _highest_birads([str(v) for v in found["birads"]])
    density = next((d for d in (norm_density(v) for v in found["density"]) if d), "")
    return ReportResult(ok=True, birads=birads, density=density)


def pdf_text(path: Path) -> str:
    try:
        out = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True,
                             text=True, timeout=30, check=False)
        return out.stdout if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def parse_text_report(text: str) -> Tuple[str, str]:
    text = _normalise_text(text)
    impression = re.search(r"\bIMPRESSION\b", text, re.I)
    # Drop the reference legend that lists every category.
    ref = re.search(r"FOR\s+REFERENCE\s*:", text, re.I)
    if ref:
        text = text[:ref.start()]
    legend = re.search(r"BI\s*-?\s*RADS?\s+Assessment\s+Categories", text, re.I)
    if legend and re.search(r"\bCategory\s+0\s*:", text[legend.end():legend.end() + 1600], re.I):
        text = text[:legend.start()]

    def birads_in(chunk: str) -> str:
        values = []
        for pattern in BIRADS_PATTERNS:
            values += [re.sub(r"\s+", "", m) for m in pattern.findall(chunk)]
        return _highest_birads(values)  # left and right can differ: the higher one describes the case

    birads = ""
    if impression:
        birads = birads_in(text[impression.start():])
    birads = birads or birads_in(text)  # some reports state it before the impression
    density = ""
    for pattern in DENSITY_PATTERNS:
        m = pattern.search(text)
        if m:
            density = m.group(1).upper()
            break
    if not density and any(p.search(text) for p, _ in DENSITY_WORDS):
        density = norm_density(text)
    return birads, density


def parse_pdf_report(path: Path) -> ReportResult:
    text = pdf_text(path)
    if not text.strip():
        return ReportResult(problem=f"{path.name}: PDF has no extractable text")
    birads, density = parse_text_report(text)
    return ReportResult(ok=True, birads=birads, density=density)


def read_report(path: Path) -> ReportResult:
    return parse_json_report(path) if path.suffix.lower() == ".json" else parse_pdf_report(path)


# --------------------------------------------------------------------------- #
# DICOM
# --------------------------------------------------------------------------- #
def _txt(ds, name: str) -> str:
    value = getattr(ds, name, "")
    if isinstance(value, (list, pydicom.multival.MultiValue)):
        return "\\".join(map(str, value))
    return str(value or "").strip()


def norm_laterality(value: str) -> str:
    v = value.strip().upper()
    return "L" if v in {"L", "LEFT"} else "R" if v in {"R", "RIGHT"} else ""


def norm_view(value: str) -> str:
    v = re.sub(r"[^A-Z]", "", value.upper())
    return "MLO" if "MLO" in v else "CC" if v.startswith("CC") or v.endswith("CC") or v == "CC" else ""


def slot_from_text(text: str) -> str:
    up = text.upper()
    m = re.search(r"(?<![A-Za-z])([LR])[-_ ]?(MLO|CC)(?![A-Za-z])", up)
    if m:
        return f"{m.group(1)}{m.group(2)}"
    m = re.search(r"(?<![A-Za-z])(MLO|CC)[-_ ]?(LEFT|RIGHT)(?![A-Za-z])", up)          # e.g. mammo_cc_left
    if m:
        return f"{m.group(2)[0]}{m.group(1)}"
    m = re.search(r"(?<![A-Za-z])(LEFT|RIGHT)[-_ ]?(MLO|CC)(?![A-Za-z])", up)          # e.g. right_mlo
    return f"{m.group(1)[0]}{m.group(2)}" if m else ""


def dicom_header_rows(ds, prefix: str = "", depth: int = 0) -> List[dict]:
    rows: List[dict] = []
    if depth > 6:
        return rows
    for el in ds:
        if el.tag == 0x7FE00010 or (el.keyword or "") in PHI_KEYWORDS:
            continue
        keyword = el.keyword or el.name or "Unknown"
        path = f"{prefix}.{keyword}" if prefix else keyword
        tag = f"({el.tag.group:04X},{el.tag.element:04X})"
        if el.VR == "SQ":
            rows.append({"tag": tag, "name": path, "vr": el.VR, "value": f"Sequence, {len(el.value)} item(s)"})
            for i, item in enumerate(el.value, 1):
                rows += dicom_header_rows(item, f"{path}[{i}]", depth + 1)
            continue
        value = f"<binary, {len(el.value):,} bytes>" if isinstance(el.value, bytes) else str(el.value)
        rows.append({"tag": tag, "name": path, "vr": el.VR, "value": value[:500]})
    return rows


@dataclass
class DicomInfo:
    path: Path
    ok: bool = False
    problem: str = ""
    slot: str = ""
    modality: str = ""
    sop_class: str = ""
    manufacturer: str = ""
    model: str = ""
    institution: str = ""
    description: str = ""  # series/protocol/image type text, used to spot DBT/synthetic
    rel: str = ""  # path relative to the case folder
    size: int = 0
    sha256: str = ""
    headers: List[dict] = field(default_factory=list)

    @property
    def is_dr(self) -> bool:
        """FFDM/DR: MG with a digital mammography SOP class, not tomosynthesis or synthetic 2D."""
        if self.modality != "MG" or self.sop_class not in DR_SOP_CLASSES:
            return False
        return not any(token in self.description.lower() for token in NON_DR_TOKENS)


def inspect_dicom(path: Path) -> DicomInfo:
    info = DicomInfo(path=path, size=path.stat().st_size)
    try:
        ds = pydicom.dcmread(str(path), stop_before_pixels=True, force=False)
    except Exception as exc:
        info.problem = f"{path.name}: unreadable DICOM ({type(exc).__name__})"
        return info
    if not (getattr(ds, "Rows", 0) and getattr(ds, "Columns", 0)):
        info.problem = f"{path.name}: DICOM has no image dimensions"
        return info
    info.modality = _txt(ds, "Modality").upper()
    info.sop_class = _txt(ds, "SOPClassUID") or str(getattr(getattr(ds, "file_meta", None), "MediaStorageSOPClassUID", "") or "")
    info.manufacturer = _txt(ds, "Manufacturer")
    info.model = _txt(ds, "ManufacturerModelName")
    info.institution = _txt(ds, "InstitutionName")
    info.description = " ".join(_txt(ds, k) for k in ("SeriesDescription", "ProtocolName", "ImageType"))
    lat = norm_laterality(_txt(ds, "ImageLaterality") or _txt(ds, "Laterality"))
    view = norm_view(_txt(ds, "ViewPosition")) or norm_view(_txt(ds, "SeriesDescription")) or norm_view(_txt(ds, "ProtocolName"))
    info.slot = f"{lat}{view}" if lat and view else ""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    info.sha256 = h.hexdigest()
    info.headers = dicom_header_rows(ds)
    info.ok = True
    return info


# --------------------------------------------------------------------------- #
# Case evaluation
# --------------------------------------------------------------------------- #
@dataclass
class CaseResult:
    name: str
    outcome: str = "passed"  # passed | rejected
    reasons: List[str] = field(default_factory=list)
    views: Dict[str, DicomInfo] = field(default_factory=dict)
    report_path: Optional[Path] = None  # the PDF that was accepted
    json_paths: List[Path] = field(default_factory=list)  # optional JSON reports kept with the case
    birads: str = ""
    density: str = ""
    content_hash: str = ""
    rel_paths: Dict[Path, str] = field(default_factory=dict)

    def fail(self, reason: str):
        self.reasons.append(reason)
        self.outcome = "rejected"


def _files(case_dir: Path) -> List[Path]:
    return sorted(p for p in case_dir.rglob("*") if p.is_file() and not p.name.startswith("."))


def evaluate_case(case_dir: Path, name: Optional[str] = None) -> CaseResult:
    result = CaseResult(name=name or case_dir.name)
    files = _files(case_dir)
    dicoms = [p for p in files if p.suffix.lower() in DICOM_EXTENSIONS and p.name.upper() != "DICOMDIR"]
    reports = [p for p in files if p.suffix.lower() in REPORT_EXTENSIONS]

    by_slot: Dict[str, List[DicomInfo]] = {}
    for path in dicoms:
        info = inspect_dicom(path)
        if not info.ok:
            result.fail(info.problem)
            continue
        slot = info.slot or slot_from_text("/".join(path.relative_to(case_dir).parts))
        if slot not in STANDARD_VIEWS:
            result.fail(f"{path.name}: view/laterality could not be determined")
            continue
        info.slot = slot
        info.rel = path.relative_to(case_dir).as_posix()
        by_slot.setdefault(slot, []).append(info)

    missing = [v for v in STANDARD_VIEWS if v not in by_slot]
    if missing:
        result.fail("Missing view(s): " + ", ".join(missing))
    for slot, items in by_slot.items():
        if len(items) > 1:
            result.fail(f"Duplicate {slot} images ({len(items)})")
    if not missing and not any(len(i) > 1 for i in by_slot.values()):
        result.views = {slot: items[0] for slot, items in by_slot.items()}
        if any(not i.is_dr for i in result.views.values()):
            seen = sorted({f"{i.modality or '?'}" for i in result.views.values() if not i.is_dr})
            result.fail("Not Digital Mammogram (DR): modality/SOP class " + ", ".join(seen))

    result.rel_paths = {p: p.relative_to(case_dir).as_posix() for p in reports}

    # Report: a PDF with BI-RADS is mandatory; JSON is optional extra data.
    pdfs = [p for p in reports if p.suffix.lower() == ".pdf"]
    jsons = [(p, parse_json_report(p)) for p in reports if p.suffix.lower() == ".json"]
    json_ok = [(p, r) for p, r in jsons if r.ok]
    if not pdfs:
        result.fail("PDF report missing (a PDF report with BI-RADS is mandatory)")
    else:
        parsed = [(p, parse_pdf_report(p)) for p in pdfs]
        readable = [(p, r) for p, r in parsed if r.ok]
        with_birads = [(p, r) for p, r in readable if r.birads]
        if with_birads:
            result.report_path, report = with_birads[0]
            result.birads, result.density = report.birads, report.density
            if not result.density:  # density is a bonus; take it from a JSON if the PDF lacks it
                result.density = next((r.density for _, r in json_ok if r.density), "")
            result.json_paths = [p for p, _ in json_ok]
            if parent_birads(result.birads) not in ALLOWED_BIRADS:
                result.fail(f"BI-RADS {result.birads} not allowed (only 3, 4, 5, 6)")
        elif readable:
            result.fail("PDF report has no BI-RADS (BI-RADS is required)")
        else:
            result.fail("PDF report not readable: " + "; ".join(r.problem for _, r in parsed))

    if result.outcome == "passed":
        digest = hashlib.sha256("".join(result.views[s].sha256 for s in STANDARD_VIEWS).encode()).hexdigest()
        result.content_hash = digest
    return result


# --------------------------------------------------------------------------- #
# Discovery / extraction
# --------------------------------------------------------------------------- #
def safe_extract_zip(zip_path: Path, dest: Path):
    total = 0
    dest = dest.resolve()
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.infolist():
            total += member.file_size
            if total > MAX_UNZIPPED_BYTES:
                raise ValueError("Zip expands beyond the allowed size")
            target = (dest / member.filename).resolve()
            if dest != target and dest not in target.parents:
                raise ValueError(f"Unsafe path in zip: {member.filename}")
        zf.extractall(dest)


# Sub-folder names that organise the inside of one case (omc_001/dicom, omc_001/pdf, ...).
_STRUCTURAL = re.compile(
    r"^(dicoms?|dcm|pdfs?|jsons?|reports?|images?|mg|mammo(gram)?s?|views?|data|[lr][-_ ]?(cc|mlo))$", re.I)
_IGNORED_DIRS = {"__MACOSX"}


def _visible_dirs(d: Path) -> List[Path]:
    return sorted(c for c in d.iterdir() if c.is_dir() and not c.name.startswith(".") and c.name not in _IGNORED_DIRS)


def _has_files(d: Path) -> bool:
    return any(p.is_file() and not p.name.startswith(".") for p in d.rglob("*"))


def _is_case_root(d: Path) -> bool:
    """A folder is one case when it holds files itself or has a dicom/pdf/json/view-style sub-folder."""
    if any(p.is_file() and not p.name.startswith(".") for p in d.iterdir()):
        return True
    return any(_STRUCTURAL.match(c.name) for c in _visible_dirs(d) if _has_files(c))


def discover_cases(root: Path) -> List[Tuple[str, Path]]:
    """Find case folders at any depth.

    omc_001/{dicom,pdf,json}/... is one case however deep the files sit inside it.
    A folder whose sub-folders are themselves cases (omc_001, omc_002, ...) is just a
    container, and wrapper folders are descended into automatically.
    """
    found: List[Path] = []

    def walk(d: Path):
        if d != root and _is_case_root(d):
            found.append(d)
            return
        children = [c for c in _visible_dirs(d) if _has_files(c)]
        if not children:
            if d == root and _is_case_root(d):
                found.append(d)
            return
        for c in children:
            walk(c)

    if _is_case_root(root) and not any(not _STRUCTURAL.match(c.name) for c in _visible_dirs(root) if _has_files(c)):
        return [(root.name, root)]
    walk(root)
    names = [d.name for d in found]
    return [(str(d.relative_to(root)) if names.count(d.name) > 1 else d.name, d) for d in found]


# --------------------------------------------------------------------------- #
# Storage + persistence
# --------------------------------------------------------------------------- #
_bucket_lock = threading.Lock()
_client = None
_buckets: Dict[str, Any] = {}


def _bucket(name: Optional[str] = None):
    """One shared storage client. Building a client per request re-does authentication and made every image slow.

    name defaults to the configured bucket (where new files are written). Stored files remember their own bucket.
    """
    global _client
    name = name or settings.GCP_STORAGE_BUCKET
    with _bucket_lock:
        if _client is None:
            from google.cloud import storage
            _client = storage.Client()
        if name not in _buckets:
            _buckets[name] = _client.bucket(name)
        return _buckets[name]


def split_gs_url(url: str) -> Tuple[Optional[str], str]:
    """'gs://bucket/path/x' -> ('bucket', 'path/x'). A bare object path gives (None, path): the configured bucket applies."""
    if url.startswith("gs://"):
        bucket, _, blob = url[5:].partition("/")
        return bucket, blob
    return None, url.lstrip("/")


def upload_to_gcs(local: Path, blob_name: str) -> str:
    if not settings.GCP_STORAGE_BUCKET:
        raise RuntimeError("GCP_STORAGE_BUCKET not configured")
    blob = _bucket().blob(blob_name)
    blob.upload_from_filename(str(local))
    return f"gs://{settings.GCP_STORAGE_BUCKET}/{blob_name}"


def read_from_gcs(url: str) -> bytes:
    """Read a stored file from the bucket named in its own address, so files written under another bucket setting still open."""
    bucket, blob = split_gs_url(url)
    return _bucket(bucket).blob(blob).download_as_bytes()


def render_dicom_png(data: bytes, center: Optional[float] = None, width: Optional[float] = None,
                     invert: bool = False, max_side: int = 1800) -> bytes:
    """Window a DICOM to an 8-bit PNG for browser display (headers/PHI are not embedded)."""
    import io
    import numpy as np
    from PIL import Image
    ds = pydicom.dcmread(io.BytesIO(data))
    arr = ds.pixel_array.astype("float32")
    arr = arr * float(getattr(ds, "RescaleSlope", 1) or 1) + float(getattr(ds, "RescaleIntercept", 0) or 0)
    if center is None or width is None:
        lo, hi = np.percentile(arr, [0.5, 99.5])
    else:
        lo, hi = center - width / 2, center + width / 2
    scaled = np.clip((arr - lo) / max(hi - lo, 1e-6), 0, 1)
    if _txt(ds, "PhotometricInterpretation") == "MONOCHROME1":
        scaled = 1 - scaled
    if invert:
        scaled = 1 - scaled
    img = Image.fromarray((scaled * 255).astype("uint8"))
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=False)
    return out.getvalue()


def pixel_cache_path(file_id: int, sha: Optional[str]) -> Path:
    return staging_root() / "pixcache" / f"{file_id}_{(sha or 'x')[:12]}.u16.gz"


def write_pixel_cache(path: Path, dicom_bytes: bytes, keep: int = 200):
    """Decode once, store the 16-bit pixels gzipped on disk, and keep the cache bounded."""
    import numpy as np
    ds = pydicom.dcmread(io.BytesIO(dicom_bytes))
    arr = ds.pixel_array
    if arr.ndim != 2:
        raise ValueError("Expected a single-frame greyscale image")
    if arr.dtype != np.uint16:
        arr = np.clip(arr.astype("int64") - min(int(arr.min()), 0), 0, 65535).astype("<u2")
    data = np.ascontiguousarray(arr, dtype="<u2").tobytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=1) as gz:
        gz.write(data)
    tmp.replace(path)
    files = sorted(path.parent.glob("*.u16.gz"), key=lambda p: p.stat().st_mtime)
    for old in files[:-keep]:
        try:
            old.unlink()
        except OSError:
            pass


def png_cache_path(file_id: int, sha: Optional[str], key: str) -> Path:
    return staging_root() / "imgcache" / f"{file_id}_{(sha or 'x')[:12]}_{key}.png"


def _trim_cache(folder: Path, pattern: str, keep: int):
    files = sorted(folder.glob(pattern), key=lambda p: p.stat().st_mtime)
    for old in files[:-keep]:
        try:
            old.unlink()
        except OSError:
            pass


def render_png_from_pixels(pix_path: Path, cols: int, rows: int, center: Optional[float], width: Optional[float],
                           invert: bool, mono1: bool, max_side: int = 1800) -> bytes:
    """Same picture as render_dicom_png but from the cached 16-bit pixels: no GCS download, no DICOM decode."""
    import numpy as np
    from PIL import Image
    with gzip.open(pix_path, "rb") as f:
        arr = np.frombuffer(f.read(), dtype="<u2").reshape(rows, cols)
    step = max(1, max(rows, cols) // (max_side * 2))            # cheap pre-shrink before the float maths
    arr = arr[::step, ::step].astype("float32")
    if center is None or width is None:
        lo, hi = np.percentile(arr, [0.5, 99.5])
    else:
        lo, hi = center - width / 2, center + width / 2
    scaled = np.clip((arr - lo) / max(hi - lo, 1e-6), 0, 1)
    if mono1:
        scaled = 1 - scaled
    if invert:
        scaled = 1 - scaled
    img = Image.fromarray((scaled * 255).astype("uint8"))
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=False)
    return out.getvalue()


def delete_blobs(urls: List[str]):
    """Remove stored objects. A blob that is already gone is fine; any other failure is raised."""
    from google.api_core.exceptions import NotFound
    for url in urls:
        name, blob = split_gs_url(url)
        try:
            _bucket(name).blob(blob).delete()
        except NotFound:
            pass


def delete_from_gcs(urls: List[str]):
    try:
        for url in urls:
            name, blob = split_gs_url(url)
            _bucket(name).blob(blob).delete()
    except Exception:
        logger.exception("Cleanup of partially uploaded case failed")


def _store_passed(db, batch: RetroBatch, result: CaseResult) -> RetroCase:
    first = result.views[STANDARD_VIEWS[0]]
    case = RetroCase(
        qc_session_id=str(uuid.uuid4()),
        qc_content_hash=result.content_hash,
        qc_batch_id=batch.qc_id,
        qc_original_name=result.name[:255],
        qc_modality="DR",
        qc_birads=result.birads or None,
        qc_density=result.density or None,
        qc_manufacturer=(first.manufacturer or None) and first.manufacturer[:120],
        qc_vendor=(batch.qc_vendor or first.institution or None),
    )
    db.add(case)
    db.flush()
    case.qc_case_code = f"case_{case.qc_id:05d}"
    uploaded: List[str] = []
    try:
        for slot in STANDARD_VIEWS:
            info = result.views[slot]
            touch_heartbeat(batch.qc_id)
            url = upload_to_gcs(info.path, f"{RETRO_GCS_PREFIX}{case.qc_case_code}/{slot}/{info.path.name}")
            uploaded.append(url)
            db.add(RetroFile(qc_case_id=case.qc_id, qc_kind="view", qc_view=slot, qc_filename=info.path.name,
                             qc_source_path=info.rel, qc_gcs_path=url, qc_size_bytes=info.size, qc_sha256=info.sha256,
                             qc_dicom_headers=info.headers))
        for rp in ([result.report_path] if result.report_path else []) + result.json_paths:
            url = upload_to_gcs(rp, f"{RETRO_GCS_PREFIX}{case.qc_case_code}/report/{rp.name}")
            uploaded.append(url)
            if rp == result.report_path:
                case.qc_report_path = url
            db.add(RetroFile(qc_case_id=case.qc_id, qc_kind="report", qc_filename=rp.name,
                             qc_source_path=result.rel_paths.get(rp), qc_gcs_path=url, qc_size_bytes=rp.stat().st_size))
        db.commit()
    except Exception:
        db.rollback()
        delete_from_gcs(uploaded)
        raise
    return case


def process_batch(batch_id: int, session_factory):
    """Run in a background thread after all files have been received."""
    db = session_factory()
    work = staging_root() / str(batch_id)
    try:
        touch_heartbeat(batch_id)
        batch = db.query(RetroBatch).get(batch_id)
        batch.qc_status, batch.qc_phase = "processing", "Unpacking"
        db.commit()

        raw = work / "raw"
        for z in list(raw.rglob("*.zip")):
            safe_extract_zip(z, z.parent / (z.stem + "_unzipped"))
            z.unlink()

        cases = discover_cases(raw)
        batch.qc_total_cases, batch.qc_phase = len(cases), "Running checks"
        db.commit()

        for name, folder in cases:
            touch_heartbeat(batch_id)
            result = evaluate_case(folder, name)
            if result.outcome == "passed":
                existing = db.query(RetroCase).filter(RetroCase.qc_content_hash == result.content_hash).first()
                if existing:
                    result.fail(f"Duplicate of {existing.qc_case_code}")
                elif db.query(RetroDeletedCase.qc_id).filter(RetroDeletedCase.qc_content_hash == result.content_hash).first():
                    result.fail("Duplicate of a case that was rejected and deleted earlier")
            if result.outcome == "passed":
                batch.qc_phase = f"Storing {name}"
                db.commit()
                _store_passed(db, batch, result)
                batch.qc_passed += 1
            else:
                db.add(RetroRejection(qc_batch_id=batch.qc_id, qc_original_name=name[:255],
                                      qc_outcome=result.outcome, qc_reasons=result.reasons))
                batch.qc_rejected += 1
            batch.qc_checked_cases += 1
            db.commit()

        batch.qc_status, batch.qc_phase = "completed", "Done"
        batch.qc_finished_at = datetime.datetime.utcnow()
        db.commit()
    except Exception as exc:
        logger.exception("Retro batch %s failed", batch_id)
        db.rollback()
        batch = db.query(RetroBatch).get(batch_id)
        if batch:
            batch.qc_status, batch.qc_phase = "failed", "Failed"
            batch.qc_error = f"{type(exc).__name__}: {exc}"[:1000]
            batch.qc_finished_at = datetime.datetime.utcnow()
            db.commit()
    finally:
        shutil.rmtree(work, ignore_errors=True)  # failed/removed cases never persist
        db.close()
