import json
import os
import shutil

os.environ.setdefault("DISABLE_SECRET_MANAGER", "true")

import pydicom
import pytest
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.src.db.session import Base
from backend.src.models.retro import RetroBatch, RetroCase, RetroRejection
from backend.src.services import retro_intake as intake

DR = "1.2.840.10008.5.1.4.1.1.1.2"
CR = "1.2.840.10008.5.1.4.1.1.1"


def write_dicom(path, lat, view, modality="MG", sop=DR, seed=0):
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = sop
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = Dataset()
    ds.file_meta = meta
    ds.SOPClassUID, ds.SOPInstanceUID = sop, meta.MediaStorageSOPInstanceUID
    ds.Modality, ds.Manufacturer = modality, "HOLOGIC"
    ds.PatientName = "Should^NotLeak"
    ds.ImageLaterality, ds.ViewPosition = lat, view
    ds.Rows = ds.Columns = 4
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 16, 15, 0
    ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, "MONOCHROME2"
    ds.PixelData = bytes([seed % 250 + 1]) * 32
    ds.is_little_endian, ds.is_implicit_VR = True, False
    pydicom.dcmwrite(str(path), ds, write_like_original=False)


def make_pdf(path, lines):
    """Smallest valid single-page PDF whose text pdftotext can extract."""
    text = "BT /F1 12 Tf 50 750 Td 14 TL " + " ".join(f"({l}) Tj T*" for l in lines) + " ET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            f"<< /Length {len(text)} >>\nstream\n{text}\nendstream", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = "%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF"
    path.write_bytes(out.encode("latin-1"))


def make_case(root, name="C1", birads="4", density="B", views=("LCC", "LMLO", "RCC", "RMLO"),
              report=True, modality="MG", sop=DR, seed=0, json_report=False):
    case = root / name
    for i, v in enumerate(views):
        write_dicom(case / "DICOM" / f"{v}.dcm", v[0], v[1:], modality, sop, seed=seed * 10 + i)
    if report:
        lines = ["RADIOLOGY REPORT", "IMPRESSION:"]
        if birads:
            lines.append(f"BI-RADS Category {birads}")
        if density:
            lines.append(f"Breast density: {density}")
        make_pdf(case / "redacted_report.pdf", lines)
    if json_report:
        data = {}
        if birads:
            data["BIRADS"] = birads
        if density:
            data["breast_density"] = density
        (case / "report.json").write_text(json.dumps(data))
    return case


def test_valid_case_passes(tmp_path):
    r = intake.evaluate_case(make_case(tmp_path))
    assert r.outcome == "passed", r.reasons
    assert r.birads == "4" and r.density == "B"
    assert set(r.views) == set(intake.STANDARD_VIEWS)


def test_birads_4a_normalised_and_allowed(tmp_path):
    r = intake.evaluate_case(make_case(tmp_path, birads="4A"))
    assert r.outcome == "passed" and r.birads == "4A"


@pytest.mark.parametrize("birads", ["0", "1", "2"])
def test_birads_outside_range_rejected(tmp_path, birads):
    r = intake.evaluate_case(make_case(tmp_path, birads=birads))
    assert r.outcome == "rejected"
    assert any("not allowed" in x for x in r.reasons)


def test_density_only_report_rejected(tmp_path):
    r = intake.evaluate_case(make_case(tmp_path, birads="", density="C"))
    assert r.outcome == "rejected" and "BI-RADS is required" in " ".join(r.reasons)


def test_tomosynthesis_description_not_dr(tmp_path):
    case = make_case(tmp_path)
    ds = pydicom.dcmread(case / "DICOM" / "LCC.dcm")
    ds.SeriesDescription = "Tomosynthesis reconstruction"
    ds.save_as(case / "DICOM" / "LCC.dcm")
    assert intake.evaluate_case(case).outcome == "rejected"


def test_report_without_birads_or_density_rejected(tmp_path):
    r = intake.evaluate_case(make_case(tmp_path, birads="", density=""))
    assert r.outcome == "rejected"


def test_missing_view_rejected(tmp_path):
    r = intake.evaluate_case(make_case(tmp_path, views=("LCC", "LMLO", "RCC")))
    assert r.outcome == "rejected" and "RMLO" in r.reasons[0]


def test_missing_report_rejected(tmp_path):
    r = intake.evaluate_case(make_case(tmp_path, report=False))
    assert r.outcome == "rejected"



def test_cr_modality_rejected(tmp_path):
    r = intake.evaluate_case(make_case(tmp_path, modality="CR", sop=CR))
    assert r.outcome == "rejected" and any("DR" in x for x in r.reasons)


def test_non_dicom_file_rejected(tmp_path):
    case = make_case(tmp_path)
    (case / "DICOM" / "LCC.dcm").write_bytes(b"not a dicom")
    assert intake.evaluate_case(case).outcome == "rejected"


def test_structural_failure_outranks_rejection(tmp_path):
    r = intake.evaluate_case(make_case(tmp_path, birads="1", views=("LCC", "LMLO", "RCC")))
    assert r.outcome == "rejected" and len(r.reasons) >= 2


def test_text_report_parsing():
    text = "IMPRESSION: BI-RADS Category 5 - highly suggestive.\nBreast density: C heterogeneously dense"
    assert intake.parse_text_report(text) == ("5", "C")


def test_header_cache_strips_patient_identifiers(tmp_path):
    case = make_case(tmp_path)
    info = intake.inspect_dicom(case / "DICOM" / "LCC.dcm")
    assert info.ok and not any(h["name"] == "PatientName" for h in info.headers)


def test_unsafe_zip_rejected(tmp_path):
    import zipfile
    z = tmp_path / "evil.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("../escape.txt", "x")
    with pytest.raises(ValueError):
        intake.safe_extract_zip(z, tmp_path / "out")


@pytest.fixture
def retro_db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'retro.db'}")
    Base.metadata.create_all(bind=engine, tables=[RetroBatch.__table__, RetroCase.__table__,
                                                  intake.RetroFile.__table__, RetroRejection.__table__, intake.RetroDeletedCase.__table__])
    monkeypatch.setenv("RETRO_STAGING_DIR", str(tmp_path / "stage"))
    uploads = []
    monkeypatch.setattr(intake, "upload_to_gcs", lambda local, blob: uploads.append(blob) or f"gs://b/{blob}")
    return sessionmaker(bind=engine), uploads, tmp_path


def test_process_batch_counts_and_only_passed_stored(retro_db):
    Session, uploads, tmp = retro_db
    db = Session()
    batch = RetroBatch(qc_vendor="Acme Hospital")
    db.add(batch)
    db.commit()
    raw = tmp / "stage" / str(batch.qc_id) / "raw" / "upload"
    make_case(raw, "good", seed=1)
    shutil.copytree(raw / "good", raw / "z_dup_of_good")  # byte-identical images -> duplicate
    make_case(raw, "low_birads", birads="2", seed=2)
    make_case(raw, "three_views", views=("LCC", "LMLO", "RCC"), seed=3)
    make_case(raw, "second_good", birads="6", seed=4)

    intake.process_batch(batch.qc_id, Session)

    db.expire_all()
    b = db.get(RetroBatch, batch.qc_id)
    assert (b.qc_status, b.qc_total_cases, b.qc_checked_cases) == ("completed", 5, 5)
    assert (b.qc_passed, b.qc_rejected, b.qc_deleted) == (2, 3, 0)
    codes = sorted(c.qc_case_code for c in db.query(RetroCase))
    assert codes == ["case_00001", "case_00002"]
    assert all(c.qc_vendor == "Acme Hospital" for c in db.query(RetroCase))
    assert len(uploads) == 10  # (4 views + report) x 2 passed cases only
    assert not (tmp / "stage" / str(batch.qc_id)).exists()
    reasons = {r.qc_original_name: r.qc_outcome for r in db.query(RetroRejection)}
    assert reasons == {"z_dup_of_good": "rejected", "low_birads": "rejected", "three_views": "rejected"}


def test_render_dicom_png(tmp_path):
    case = make_case(tmp_path)
    png = intake.render_dicom_png((case / "DICOM" / "LCC.dcm").read_bytes())
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def make_nested_case(root, name, seed=0, depth=0, birads="4"):
    """omc_001/{dicom, pdf, json}: the layout the data providers use."""
    case = root / name
    for i, v in enumerate(("LCC", "LMLO", "RCC", "RMLO")):
        write_dicom(case.joinpath(*(["extra"] * depth)) / "dicom" / f"img{i}.dcm", v[0], v[1:], seed=seed * 10 + i)
    (case / "pdf").mkdir(parents=True, exist_ok=True)
    make_pdf(case / "pdf" / "redacted_report.pdf", ["IMPRESSION:", f"BI-RADS Category {birads}", "Breast density: B"])
    (case / "json").mkdir(exist_ok=True)
    (case / "json" / "meta.json").write_text(json.dumps({"breast_density": "B"}))
    return case


def test_separate_pdf_json_dicom_folders_pass(tmp_path):
    case = make_nested_case(tmp_path, "omc_001")
    r = intake.evaluate_case(case)
    assert r.outcome == "passed", r.reasons
    assert len(r.json_paths) == 1 and r.report_path.parent.name == "pdf"
    assert {v.rel.split("/")[0] for v in r.views.values()} == {"dicom"}


def test_deeply_nested_folders_pass(tmp_path):
    case = make_nested_case(tmp_path, "omc_001", depth=3)
    assert intake.evaluate_case(case).outcome == "passed"


def test_discover_many_cases_in_upload(tmp_path):
    root = tmp_path / "raw"
    for n in ("omc_001", "omc_002", "omc_003"):
        make_nested_case(root, n, seed=int(n[-1]))
    assert [n for n, _ in intake.discover_cases(root)] == ["omc_001", "omc_002", "omc_003"]


def test_discover_through_wrapper_folders(tmp_path):
    root = tmp_path / "raw"
    for n in ("omc_001", "omc_002"):
        make_nested_case(root / "my_upload" / "batch", n, seed=int(n[-1]))
    assert [n for n, _ in intake.discover_cases(root)] == ["omc_001", "omc_002"]


def test_single_case_folder_is_one_case_not_three(tmp_path):
    root = tmp_path / "raw"
    make_nested_case(root, "omc_001")
    cases = intake.discover_cases(root)
    assert [n for n, _ in cases] == ["omc_001"]


def test_dicomdir_file_is_ignored(tmp_path):
    case = make_nested_case(tmp_path, "omc_001")
    (case / "dicom" / "DICOMDIR").write_bytes(b"index")
    assert intake.evaluate_case(case).outcome == "passed"


def test_same_case_name_in_two_places_is_disambiguated(tmp_path):
    root = tmp_path / "raw"
    make_nested_case(root / "a", "omc_001", seed=1)
    make_nested_case(root / "b", "omc_001", seed=2)
    assert sorted(n for n, _ in intake.discover_cases(root)) == ["a/omc_001", "b/omc_001"]


@pytest.mark.parametrize("text,expected", [
    ("Right breast \u2013 BIRADS category \u2013 IVc.\nLeft breast \u2013 BIRADS category \u2013 I.", "4C"),
    ("IMPRESSION: BI-RADS 4A", "4A"), ("BIRADS: IV", "4"), ("BI-RADS Category 5", "5"), ("BIRADS-6", "6"),
    ("Right breast category 3, left breast category 2", "3"), ("BI-RADS Assessment: 0", "0"),
    ("Findings: BI-RADS 2. IMPRESSION: Right breast BIRADS category IV b", "4B"),
])
def test_birads_reading_handles_real_report_styles(text, expected):
    assert intake.parse_text_report(text)[0] == expected


def test_birads_not_taken_from_ordinary_words():
    assert intake.parse_text_report("The BI-RADS in this report is not stated. I think so.")[0] == ""


def test_dcm_extension_any_case_only(tmp_path):
    case = make_nested_case(tmp_path, "omc_001")
    for f in (case / "dicom").glob("*.dcm"):
        f.rename(f.with_suffix(".DCM"))
    assert intake.evaluate_case(case).outcome == "passed"
    for f in (case / "dicom").glob("*.DCM"):
        f.rename(f.with_suffix(""))
    r = intake.evaluate_case(case)
    assert r.outcome == "rejected" and "Missing view" in " ".join(r.reasons)


def test_cut_off_batches_are_marked_interrupted(client, monkeypatch, tmp_path):
    import os
    import time
    from backend.src.api.retro import PROCESSING_STALE_SECONDS, UPLOADING_STALE_SECONDS
    from backend.tests.conftest import TestSession
    from backend.tests.test_retro_assign import B, token
    monkeypatch.setenv("RETRO_STAGING_DIR", str(tmp_path))
    admin = token("admin@test.com", "Admin")
    db = TestSession()
    live, dead, idle = RetroBatch(qc_status="processing"), RetroBatch(qc_status="processing"), RetroBatch(qc_status="uploading")
    db.add_all([live, dead, idle])
    db.commit()
    ids = (live.qc_id, dead.qc_id, idle.qc_id)
    db.close()
    intake.touch_heartbeat(ids[0])                                          # still working
    intake.touch_heartbeat(ids[1])                                          # worker died long ago
    old = time.time() - PROCESSING_STALE_SECONDS - 5
    os.utime(tmp_path / str(ids[1]) / ".alive", (old, old))
    intake.touch_heartbeat(ids[2])
    older = time.time() - UPLOADING_STALE_SECONDS - 5
    os.utime(tmp_path / str(ids[2]) / ".alive", (older, older))

    assert client.get(f"{B}/batches/{ids[0]}", headers=admin).json()["status"] == "processing"
    cut = client.get(f"{B}/batches/{ids[1]}", headers=admin).json()
    assert cut["status"] == "failed" and cut["phase"] == "Interrupted" and "upload the folder again" in cut["error"].lower()
    assert client.get(f"{B}/batches/{ids[2]}", headers=admin).json()["status"] == "failed"


@pytest.mark.parametrize("name,slot", [
    ("clinic_00008_x_mammo_cc_left_20260831.dcm", "LCC"), ("clinic_00008_x_mammo_mlo_right_20260831.dcm", "RMLO"),
    ("right_cc.dcm", "RCC"), ("Left-MLO.DCM", "LMLO"), ("LCC.dcm", "LCC"), ("r_mlo.dcm", "RMLO"), ("scan_01.dcm", ""),
])
def test_view_from_file_name(name, slot):
    assert intake.slot_from_text(name) == slot


def test_stored_files_are_read_from_their_own_bucket():
    assert intake.split_gs_url("gs://breast-cancer-image-dataset/retrospective/case_00003/LCC/LCC.dcm") == (
        "breast-cancer-image-dataset", "retrospective/case_00003/LCC/LCC.dcm")
    assert intake.split_gs_url("retrospective/case_00003/x.pdf") == (None, "retrospective/case_00003/x.pdf")


def test_each_bucket_gets_its_own_handle(monkeypatch):
    seen = []

    class FakeClient:
        def bucket(self, name):
            seen.append(name)
            return f"bucket:{name}"
    import sys
    import types
    fake = types.ModuleType("google.cloud.storage")
    fake.Client = FakeClient
    monkeypatch.setitem(sys.modules, "google.cloud.storage", fake)
    monkeypatch.setattr("google.cloud.storage", fake, raising=False)
    monkeypatch.setattr(intake, "_client", None)
    monkeypatch.setattr(intake, "_buckets", {})
    assert intake._bucket("a") == "bucket:a" and intake._bucket("b") == "bucket:b" and intake._bucket("a") == "bucket:a"
    assert seen == ["a", "b"]                                  # a handle is made once per bucket, then reused
