import gzip
import io
import os
import struct
import zipfile

os.environ.setdefault("DISABLE_SECRET_MANAGER", "true")

import pytest

from backend.src.core.security import create_access_token
from backend.src.models.models import User
from backend.src.models.retro import RetroBatch, RetroCase, RetroFile
from backend.src.services import retro_intake as intake
from backend.src.services import retro_mail
from backend.src.services.retro_workflow import decode_nifti_mask
from backend.tests.conftest import TestSession

B = "/api/v1/qc/retro"


def real_nifti_gz(cols, rows, pixels=None):
    """Byte-for-byte the same layout as the browser's buildNifti (frontend seg/segTools.js): a 352-byte
    NIfTI-1 header followed by one uint8 per pixel, flat row-major (y * cols + x)."""
    pixels = pixels if pixels is not None else bytes(cols * rows)
    assert len(pixels) == cols * rows
    out = bytearray(352 + cols * rows)
    dv = struct
    struct.pack_into("<i", out, 0, 348)
    struct.pack_into("<8h", out, 40, 2, cols, rows, 1, 1, 1, 1, 1)
    struct.pack_into("<h", out, 70, 2)      # datatype = uint8
    struct.pack_into("<h", out, 72, 8)      # bitpix = 8
    struct.pack_into("<f", out, 108, 352)   # vox_offset
    out[344:348] = b"n+1\x00"
    out[352:352 + len(pixels)] = pixels
    return gzip.compress(bytes(out))


def token(email, role):
    db = TestSession()
    u = db.query(User).filter(User.qc_email == email).first()
    t = create_access_token({"sub": email, "hospital_id": u.qc_hospital_id, "role": role})
    db.close()
    return {"Authorization": f"Bearer {t}"}


def _fresh_mammo_tech():
    """A dedicated Mammo Tech per test, so tests in this file don't see each other's assignments
    on the shared test database (it persists for the whole pytest session, unlike `env`'s GCS stub)."""
    from backend.src.core.security import get_password_hash
    from backend.src.models.models import Role
    db = TestSession()
    role = db.query(Role).filter(Role.qc_name == "Mammo Tech").first()
    email = f"mt-{os.urandom(4).hex()}@test.com"
    db.add(User(qc_email=email, qc_password_hash=get_password_hash("password123"),
                qc_hospital_id="clinic_00001", qc_role_id=role.qc_id, qc_is_active=True, qc_full_name="Fresh Mammo Tech"))
    db.commit()
    u = db.query(User).filter(User.qc_email == email).first()
    user_id, db_email = u.qc_id, u.qc_email
    db.close()
    return user_id, db_email


def test_decode_nifti_mask_matches_browser_encoding():
    # A 3x2 (cols x rows) mask with pixel (x=2, y=1) set: flat index = y*cols+x = 1*3+2 = 5
    pixels = bytearray(6)
    pixels[5] = 1
    arr = decode_nifti_mask(real_nifti_gz(3, 2, bytes(pixels)))
    assert arr.shape == (2, 3)          # (rows, cols)
    assert arr[1, 2] and arr.sum() == 1


def test_decode_nifti_mask_rejects_garbage():
    with pytest.raises(ValueError):
        decode_nifti_mask(gzip.compress(b"not a nifti file"))


def test_render_mask_overlay_png_is_same_size_as_the_source():
    png = intake.render_mask_overlay_png(real_nifti_gz(5, 6))
    from PIL import Image
    img = Image.open(io.BytesIO(png))
    assert img.mode == "RGBA" and img.size == (5, 6)


@pytest.fixture
def env(monkeypatch):
    stored, mails = {}, []
    monkeypatch.setattr(intake, "upload_to_gcs", lambda local, blob: stored.setdefault(blob, open(local, "rb").read()) and f"gs://b/{blob}")
    monkeypatch.setattr(intake, "read_from_gcs", lambda url: stored[url.split("/", 3)[3]])
    monkeypatch.setattr(retro_mail, "send_template_email", lambda db, key, to, vars, **kw: mails.append((key, to, vars)) or True)
    db = TestSession()
    batch = RetroBatch(qc_status="completed")
    db.add(batch)
    db.commit()
    c = RetroCase(qc_session_id=f"s-{os.urandom(4).hex()}", qc_content_hash=os.urandom(32).hex(), qc_batch_id=batch.qc_id,
                  qc_original_name="Patient_Folder_007", qc_modality="DR", qc_birads="4")
    db.add(c)
    db.flush()
    c.qc_case_code = f"case_{c.qc_id:05d}"
    case_id = c.qc_id
    for view in ("LCC", "LMLO", "RCC", "RMLO"):
        db.add(RetroFile(qc_case_id=case_id, qc_kind="view", qc_view=view, qc_filename=f"{view}.dcm",
                         qc_gcs_path=f"gs://b/raw/{view}.dcm",
                         qc_dicom_headers=[{"name": "Rows", "value": "6"}, {"name": "Columns", "value": "5"}]))
        stored[f"raw/{view}.dcm"] = f"dicom-bytes-{view}".encode()
    db.commit()
    db.close()
    return case_id, mails


def _segment_and_complete(client, admin, mt, tech_id, case_id):
    client.post(f"{B}/assign", json={"mammo_tech_id": tech_id, "from_case": case_id, "to_case": case_id}, headers=admin)
    client.post(f"{B}/cases/{case_id}/start", headers=mt)
    up = client.post(f"{B}/cases/{case_id}/masks", data={"view": "LCC"},
                     files={"file": ("m.nii.gz", real_nifti_gz(5, 6), "application/gzip")}, headers=mt)
    assert up.status_code == 200
    fin = client.post(f"{B}/cases/{case_id}/complete", json={"note": "done"}, headers=mt)
    assert fin.status_code == 200


def test_mask_overlay_png_endpoint(client, env):
    case_id, _ = env
    tech_id, tech_email = _fresh_mammo_tech()
    admin, mt = token("admin@test.com", "Admin"), token(tech_email, "Mammo Tech")
    _segment_and_complete(client, admin, mt, tech_id, case_id)

    detail = client.get(f"{B}/cases/{case_id}", headers=admin).json()
    mask_id = detail["masks"][0]["id"]

    r = client.get(f"{B}/cases/{case_id}/masks/{mask_id}/overlay.png", headers=admin)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    from PIL import Image
    img = Image.open(io.BytesIO(r.content))
    assert img.size == (5, 6) and img.mode == "RGBA"

    assert client.get(f"{B}/cases/{case_id}/masks/{mask_id}/overlay.png", headers=mt).status_code == 200
    assert client.get(f"{B}/cases/{case_id}/masks/{99999}/overlay.png", headers=admin).status_code == 404


def test_mammo_tech_masks_zip_includes_views_and_masks(client, env):
    case_id, _ = env
    tech_id, tech_email = _fresh_mammo_tech()
    admin, mt = token("admin@test.com", "Admin"), token(tech_email, "Mammo Tech")

    assert client.get(f"{B}/mammo-techs/{tech_id}/masks.zip", headers=admin).status_code == 404  # nothing segmented yet
    _segment_and_complete(client, admin, mt, tech_id, case_id)

    assert client.get(f"{B}/mammo-techs/{tech_id}/masks.zip", headers=mt).status_code == 403  # admin only

    r = client.get(f"{B}/mammo-techs/{tech_id}/masks.zip", headers=admin)
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    assert "Patient_Folder_007/LCC/LCC.dcm" in names
    assert "Patient_Folder_007/LMLO/LMLO.dcm" in names
    assert "Patient_Folder_007/RCC/RCC.dcm" in names
    assert "Patient_Folder_007/RMLO/RMLO.dcm" in names
    assert sum(1 for n in names if n.startswith("Patient_Folder_007/segmentation/")) == 1
    assert zf.read("Patient_Folder_007/LCC/LCC.dcm") == b"dicom-bytes-LCC"


def test_mammo_tech_masks_zip_unknown_tech(client, env):
    admin = token("admin@test.com", "Admin")
    assert client.get(f"{B}/mammo-techs/999999/masks.zip", headers=admin).status_code == 404
