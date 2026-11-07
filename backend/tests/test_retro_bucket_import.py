import os

os.environ.setdefault("DISABLE_SECRET_MANAGER", "true")

import pytest

from backend.src.models.retro import RetroBatch, RetroCase, RetroRejection
from backend.src.services import retro_bucket_import as bi
from backend.src.services import retro_intake as intake
from backend.tests.test_retro_intake import make_case, retro_db  # noqa: F401  (fixture)


class FakeBlob:
    def __init__(self, name, source):
        self.name, self._source, self.size = name, source, source.stat().st_size if source else 0

    def download_to_filename(self, target):
        import shutil
        shutil.copyfile(self._source, target)


class FakeBucket:
    def __init__(self, root, prefix_in_bucket="incoming/"):
        self.blobs = [FakeBlob(prefix_in_bucket + p.relative_to(root).as_posix(), p) for p in sorted(root.rglob("*")) if p.is_file()]
        self.client = self

    def list_blobs(self, bucket, prefix=""):
        return [b for b in self.blobs if b.name.startswith(prefix)]


@pytest.fixture
def fake(retro_db, monkeypatch):  # noqa: F811
    Session, uploads, tmp = retro_db
    src = tmp / "bucket"
    make_case(src / "org" / "FOLDER_A", "p1", seed=1)
    make_case(src / "org" / "FOLDER_A", "p2", birads="2", seed=2)          # BI-RADS 2 -> rejected
    make_case(src / "org" / "FOLDER_A", "p3", views=("LCC", "LMLO", "RCC"), seed=3)   # missing view
    make_case(src / "org" / "FOLDER_B", "q1", seed=4)
    monkeypatch.setattr(intake, "_bucket", lambda name=None: FakeBucket(src))
    monkeypatch.setattr(bi.settings, "GCP_STORAGE_BUCKET", "anon-bucket", raising=False)
    return Session, uploads, tmp


def run(Session, folder):
    db = Session()
    batch = RetroBatch(qc_vendor="Omics Bank", qc_source_name=f"bucket:{folder}", qc_status="processing")
    db.add(batch)
    db.commit()
    bi.import_folder(batch.qc_id, folder, Session)
    db.expire_all()
    return db, db.get(RetroBatch, batch.qc_id)


def test_folders_are_listed_per_supplier_folder(fake):
    rows = bi.list_folders()
    assert [(r["folder"], r["objects"]) for r in rows] == [("org/FOLDER_A", 14), ("org/FOLDER_B", 5)]


def test_import_applies_the_same_checks_and_stores_passing_cases(fake):
    Session, uploads, tmp = fake
    db, b = run(Session, "org/FOLDER_A")
    assert (b.qc_status, b.qc_total_cases, b.qc_checked_cases, b.qc_passed, b.qc_rejected) == ("completed", 3, 3, 1, 2)
    assert [c.qc_vendor for c in db.query(RetroCase)] == ["Omics Bank"]
    assert len(uploads) == 5 and all(u.startswith("retrospective/case_00001/") for u in uploads)
    assert {r.qc_original_name for r in db.query(RetroRejection)} == {"p2", "p3"}
    assert not (tmp / "stage" / str(b.qc_id)).exists()


def test_running_again_skips_cases_already_stored(fake):
    Session, uploads, _ = fake
    run(Session, "org/FOLDER_A")
    db, b = run(Session, "org/FOLDER_A")
    assert b.qc_passed == 0 and "1 already stored" in b.qc_phase
    assert db.query(RetroCase).count() == 1 and len(uploads) == 5


def test_a_folder_outside_incoming_is_refused():
    for bad in ("../secret", "a/../../b", "", "/"):
        with pytest.raises(ValueError):
            bi.clean_folder(bad)
    assert bi.clean_folder("th-bcd/MAMMO_50") == "incoming/th-bcd/MAMMO_50/"
