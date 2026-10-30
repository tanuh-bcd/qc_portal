import gzip
import os
import struct

os.environ.setdefault("DISABLE_SECRET_MANAGER", "true")

import pytest

from backend.src.core.security import create_access_token
from backend.src.models.models import User
from backend.src.models.retro import RetroBatch, RetroCase, RetroFile
from backend.src.services import retro_intake as intake
from backend.src.services import retro_mail
from backend.src.services.retro_workflow import read_nifti_header, validate_nifti_gz
from backend.tests.conftest import TestSession

B = "/api/v1/qc/retro"


def nifti_gz(nx=4, ny=4, valid=True):
    head = bytearray(348)
    struct.pack_into("<i", head, 0, 348 if valid else 12)
    struct.pack_into("<8h", head, 40, 2, nx, ny, 1, 1, 1, 1, 1)
    head[344:348] = b"n+1\x00"
    return gzip.compress(bytes(head) + b"\x00" * (nx * ny))


def token(email, role):
    db = TestSession()
    u = db.query(User).filter(User.qc_email == email).first()
    t = create_access_token({"sub": email, "hospital_id": u.qc_hospital_id, "role": role})
    db.close()
    return {"Authorization": f"Bearer {t}"}


def uid(email):
    db = TestSession()
    v = db.query(User).filter(User.qc_email == email).first().qc_id
    db.close()
    return v


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
    ids = []
    for i in range(6):
        c = RetroCase(qc_session_id=f"s-{os.urandom(4).hex()}", qc_content_hash=os.urandom(32).hex(), qc_batch_id=batch.qc_id,
                      qc_original_name=f"orig{i}", qc_modality="DR", qc_birads="4")
        db.add(c)
        db.flush()
        c.qc_case_code = f"case_{c.qc_id:05d}"
        ids.append(c.qc_id)
    # the first case knows its LCC image size, so mask size can be checked
    db.add(RetroFile(qc_case_id=ids[0], qc_kind="view", qc_view="LCC", qc_filename="a.dcm", qc_gcs_path="gs://b/a",
                     qc_dicom_headers=[{"name": "Rows", "value": "6"}, {"name": "Columns", "value": "5"}]))
    db.commit()
    db.close()
    return ids, mails


def test_nifti_header():
    assert validate_nifti_gz(nifti_gz()) == ""
    assert validate_nifti_gz(nifti_gz(valid=False)) != ""
    assert "gzip" in validate_nifti_gz(b"plain")
    assert read_nifti_header(nifti_gz(7, 9))[1] == (7, 9, 1)


def test_assign_and_filters(client, env):
    ids, mails = env
    admin = token("admin@test.com", "Admin")
    tech = uid("mammotech@test.com")
    r = client.post(f"{B}/assign", json={"mammo_tech_id": tech, "from_case": ids[1], "to_case": ids[3]}, headers=admin)
    assert r.status_code == 200 and r.json()["assigned"] == 3
    again = client.post(f"{B}/assign", json={"mammo_tech_id": tech, "from_case": ids[1], "to_case": ids[4]}, headers=admin).json()
    assert again["assigned"] == 1 and len(again["already_assigned"]) == 3
    assert [m[0] for m in mails] == ["retro_cases_assigned", "retro_cases_assigned"]
    assert mails[0][2]["case_count"] == "3" and mails[0][2]["first_case"].startswith("case_")

    items = client.get(f"{B}/cases?status=awaiting&page_size=50", headers=admin).json()["items"]
    assert {i["id"] for i in items} == set(ids[1:5])
    assert items[0]["assignment"]["mammo_tech_name"] == "Tina Mammo Tech"
    free = client.get(f"{B}/cases?status=unassigned&page_size=50", headers=admin).json()["items"]
    assert ids[0] in {i["id"] for i in free}
    un = client.post(f"{B}/unassign", json=[ids[1]], headers=admin).json()
    assert un["unassigned"] == 1


def test_full_loop_mammo_radiologist_mammo(client, env):
    ids, mails = env
    admin, mt, rad = token("admin@test.com", "Admin"), token("mammotech@test.com", "Mammo Tech"), token("radiologist@test.com", "Radiologist")
    c = ids[0]
    client.post(f"{B}/assign", json={"mammo_tech_id": uid("mammotech@test.com"), "from_case": c, "to_case": c}, headers=admin)
    assert c in [x["id"] for x in client.get(f"{B}/my-cases", headers=mt).json()]
    assert c not in [x["id"] for x in client.get(f"{B}/radiologist-cases", headers=rad).json()]
    assert client.get(f"{B}/cases/{c}", headers=rad).status_code == 404  # not escalated yet

    assert client.post(f"{B}/cases/{c}/start", headers=mt).json()["status"] == "in_progress"
    files = lambda data, name="m.nii.gz": {"file": (name, data)}
    assert client.post(f"{B}/cases/{c}/masks", data={"view": "LCC"}, files=files(b"junk"), headers=mt).status_code == 400
    assert client.post(f"{B}/cases/{c}/masks", data={"view": "LCC"}, files=files(nifti_gz(), "m.png"), headers=mt).status_code == 400
    assert client.post(f"{B}/cases/{c}/masks", data={"view": "XYZ"}, files=files(nifti_gz(5, 6)), headers=mt).status_code == 400
    wrong = client.post(f"{B}/cases/{c}/masks", data={"view": "LCC"}, files=files(nifti_gz(4, 4)), headers=mt)
    assert wrong.status_code == 400 and "5 x 6" in wrong.json()["detail"]
    ok = client.post(f"{B}/cases/{c}/masks", data={"view": "LCC"}, files=files(nifti_gz(5, 6)), headers=mt)
    assert ok.status_code == 200 and ok.json()["annotation"]["views"] == ["LCC"] and not ok.json()["annotation"]["done"]

    assert client.post(f"{B}/cases/{c}/escalate", json={"note": "  "}, headers=mt).status_code == 400
    esc = client.post(f"{B}/cases/{c}/escalate", json={"note": "Unsure about density near the nipple"}, headers=mt).json()
    assert esc["status"] == "with_radiologist" and esc["assignment"]["radiologist_name"] == "Dr. Radiologist"
    assert mails[-1][0] == "retro_case_escalated" and mails[-1][1] == "radiologist@test.com"
    assert client.post(f"{B}/cases/{c}/masks", data={"view": "LCC"}, files=files(nifti_gz(5, 6)), headers=mt).status_code == 409

    # radiologist side
    assert c in [x["id"] for x in client.get(f"{B}/radiologist-cases", headers=rad).json()]
    detail = client.get(f"{B}/cases/{c}", headers=rad).json()
    assert detail["viewer_role"] == "radiologist" and detail["notes"] == [] and "density near the nipple" in detail["instruction"]["body"]
    assert client.post(f"{B}/cases/{c}/radiologist/start", headers=rad).json()["status"] == "radiologist_in_progress"
    assert client.post(f"{B}/cases/{c}/notes", json={"body": "Lesion in upper outer quadrant."}, headers=rad).status_code == 200
    assert client.post(f"{B}/cases/{c}/masks", data={"view": "LCC"}, files=files(nifti_gz(5, 6)), headers=rad).status_code == 403
    circle = {"type": "circle", "color": "#ff3b30", "width": 4, "box": {"x0": 1, "y0": 1, "x1": 3, "y1": 3}}
    assert client.put(f"{B}/cases/{c}/marks", json={"view": "LCC", "shapes": [{"type": "x"}]}, headers=rad).status_code == 400
    assert client.put(f"{B}/cases/{c}/marks", json={"view": "LCC", "shapes": [circle]}, headers=rad).status_code == 200
    assert client.put(f"{B}/cases/{c}/marks", json={"view": "LCC", "shapes": [circle, circle]}, headers=rad).status_code == 200
    assert client.post(f"{B}/cases/{c}/radiologist/complete", json={"note": ""}, headers=rad).status_code == 400
    back = client.post(f"{B}/cases/{c}/radiologist/complete", json={"note": "Marked the lesion; please refine."}, headers=rad).json()
    assert back["status"] == "in_progress" and back["assignment"]["radiologist_reviewed"]
    assert mails[-1][0] == "retro_case_returned" and mails[-1][1] == "mammotech@test.com"
    assert client.post(f"{B}/cases/{c}/notes", json={"body": "late"}, headers=rad).status_code == 200  # may still read/comment
    # the Mammo Tech sees only the live Radiologist marks and the latest instruction, never the history
    md = client.get(f"{B}/cases/{c}", headers=mt).json()
    assert md["notes"] == [] and md["instruction"]["role"] == "radiologist" and "refine" in md["instruction"]["body"]
    assert [(m["role"], len(m["shapes"])) for m in md["marks"]] == [("radiologist", 2)] and md["marks"][0]["by"] == "Dr. Radiologist"
    assert client.post(f"{B}/cases/{c}/marks/clear-other", json={"body": "LCC"}, headers=mt).json()["removed"] == 1
    assert client.get(f"{B}/cases/{c}", headers=mt).json()["marks"] == []

    # mammo tech finishes
    fin = client.post(f"{B}/cases/{c}/complete", json={"note": "Refined using guidance."}, headers=mt).json()
    assert fin["status"] == "segmented" and fin["annotation"]["done"] and fin["annotation"]["by"] == "Tina Mammo Tech"

    # admin sees everything, changes nothing
    d = client.get(f"{B}/cases/{c}", headers=admin).json()
    assert {m["role"] for m in d["masks"]} == {"mammo_tech"} and len(d["notes"]) == 5
    assert d["marks"] == []                                  # marks stay between the Mammo Tech and the Radiologist
    assert client.post(f"{B}/cases/{c}/notes", json={"body": "x"}, headers=admin).status_code == 403
    z = client.get(f"{B}/cases/{c}/masks.zip", headers=admin)
    assert z.status_code == 200 and z.content[:2] == b"PK"
    mask_id = d["masks"][0]["id"]
    assert client.get(f"{B}/cases/{c}/masks/{mask_id}/download", headers=mt).status_code == 403
    assert client.get(f"{B}/cases/{c}/masks.zip", headers=mt).status_code == 403
    assert client.get(f"{B}/cases/{c}/masks/{mask_id}/data", headers=mt).status_code == 200
    assert client.get(f"{B}/cases/{c}/masks/{mask_id}/download", headers=admin).status_code == 200

    tally = client.get(f"{B}/tally", headers=admin).json()["by_status"]
    assert tally["segmented"] >= 1


def test_complete_needs_a_mask(client, env):
    ids, _ = env
    admin, mt = token("admin@test.com", "Admin"), token("mammotech@test.com", "Mammo Tech")
    c = ids[2]
    client.post(f"{B}/assign", json={"mammo_tech_id": uid("mammotech@test.com"), "from_case": c, "to_case": c}, headers=admin)
    assert client.post(f"{B}/cases/{c}/complete", json={}, headers=mt).status_code == 400


def test_permissions(client, env):
    ids, _ = env
    admin, mt, rad = token("admin@test.com", "Admin"), token("mammotech@test.com", "Mammo Tech"), token("radiologist@test.com", "Radiologist")
    assert client.post(f"{B}/assign", json={"mammo_tech_id": 1, "from_case": 1, "to_case": 2}, headers=mt).status_code == 403
    assert client.get(f"{B}/my-cases", headers=admin).status_code == 403
    assert client.get(f"{B}/my-cases", headers=rad).status_code == 403
    assert client.get(f"{B}/radiologist-cases", headers=mt).status_code == 403
    assert client.get(f"{B}/cases/{ids[5]}", headers=mt).status_code == 404  # unassigned: not theirs
    assert client.get(f"{B}/cases/{ids[5]}", headers=admin).status_code == 200
    assert client.post(f"{B}/cases/{ids[5]}/start", headers=mt).status_code == 404
    assert client.post(f"{B}/assign", json={"mammo_tech_id": 99999, "from_case": 1, "to_case": 2}, headers=admin).status_code == 404
    assert client.post(f"{B}/assign", json={"mammo_tech_id": uid("mammotech@test.com"), "from_case": 5, "to_case": 2}, headers=admin).status_code == 400


def test_email_values_are_html_escaped(monkeypatch):
    sent = []
    monkeypatch.setattr(retro_mail, "send_template_email", lambda db, key, to, vars, **kw: sent.append(vars) or True)

    class U:
        qc_email, qc_full_name = "a@b.com", "<b>Dr</b>"
    retro_mail.notify_escalated(None, U, "case_00001", "Tina", "<script>x</script>\nsecond line")
    assert "<script>" not in sent[0]["note"] and "&lt;script&gt;" in sent[0]["note"] and "<br>" in sent[0]["note"]
    assert sent[0]["full_name"] == "&lt;b&gt;Dr&lt;/b&gt;"


def _second_tech():
    """A second active Mammo Tech to move cases to."""
    from backend.src.core.security import get_password_hash
    from backend.src.models.models import Role
    db = TestSession()
    if not db.query(User).filter(User.qc_email == "mammotech_b@test.com").first():
        role = db.query(Role).filter(Role.qc_name == "Mammo Tech").first()
        base = db.query(User).filter(User.qc_email == "mammotech@test.com").first()
        db.add(User(qc_email="mammotech_b@test.com", qc_password_hash=get_password_hash("password123"),
                    qc_hospital_id=base.qc_hospital_id, qc_role_id=role.qc_id, qc_is_active=True, qc_full_name="Ravi Mammo Tech"))
        db.commit()
    v = db.query(User).filter(User.qc_email == "mammotech_b@test.com").first().qc_id
    db.close()
    return v


def _owner(client, admin, case_id):
    return client.get(f"{B}/cases/{case_id}", headers=admin).json()["assignment"]["mammo_tech_name"]


def test_exclude_and_per_case_assignment(client, env):
    ids, mails = env
    admin = token("admin@test.com", "Admin")
    tina, ravi = uid("mammotech@test.com"), _second_tech()
    # range for Tina, but case ids[2] is meant for Ravi
    r = client.post(f"{B}/assign", json={"mammo_tech_id": tina, "from_case": ids[0], "to_case": ids[4], "exclude": [ids[2]]}, headers=admin).json()
    assert r["assigned"] == 4 and r["not_found"] == 0
    r = client.post(f"{B}/assign", json={"mammo_tech_id": ravi, "case_ids": [ids[2]]}, headers=admin).json()
    assert r["assigned"] == 1 and r["mammo_tech"] == "Ravi Mammo Tech"
    assert _owner(client, admin, ids[2]) == "Ravi Mammo Tech" and _owner(client, admin, ids[1]) == "Tina Mammo Tech"
    to = [m[1] for m in mails if m[0] == "retro_cases_assigned"]
    assert to == ["mammotech@test.com", "mammotech_b@test.com"]


def test_reassign_only_moves_cases_not_yet_opened(client, env):
    ids, mails = env
    admin, mt = token("admin@test.com", "Admin"), token("mammotech@test.com", "Mammo Tech")
    tina, ravi = uid("mammotech@test.com"), _second_tech()
    client.post(f"{B}/assign", json={"mammo_tech_id": tina, "from_case": ids[0], "to_case": ids[2]}, headers=admin)
    # without reassign, an assigned case is left alone
    r = client.post(f"{B}/assign", json={"mammo_tech_id": ravi, "case_ids": [ids[0]]}, headers=admin).json()
    assert r["assigned"] == 0 and r["moved"] == 0 and len(r["already_assigned"]) == 1
    assert _owner(client, admin, ids[0]) == "Tina Mammo Tech"
    # Tina opens case 1, so it is locked; case 2 is still Awaiting, so it can move
    client.post(f"{B}/cases/{ids[0]}/start", headers=mt)
    r = client.post(f"{B}/assign", json={"mammo_tech_id": ravi, "case_ids": [ids[0], ids[1]], "reassign": True}, headers=admin).json()
    assert r["moved"] == 1 and len(r["locked"]) == 1
    assert _owner(client, admin, ids[0]) == "Tina Mammo Tech" and _owner(client, admin, ids[1]) == "Ravi Mammo Tech"
    assert mails[-1][0] == "retro_cases_assigned" and mails[-1][1] == "mammotech_b@test.com"
    # assigning to the same person is a no-op
    r = client.post(f"{B}/assign", json={"mammo_tech_id": ravi, "case_ids": [ids[1]], "reassign": True}, headers=admin).json()
    assert r["moved"] == 0 and len(r["already_assigned"]) == 1


def test_assign_input_validation(client, env):
    ids, _ = env
    admin = token("admin@test.com", "Admin")
    tina = uid("mammotech@test.com")
    assert client.post(f"{B}/assign", json={"mammo_tech_id": tina}, headers=admin).status_code == 400
    assert client.post(f"{B}/assign", json={"mammo_tech_id": tina, "case_ids": []}, headers=admin).status_code == 400
    # range and ids can be combined; excluding everything leaves nothing to do
    r = client.post(f"{B}/assign", json={"mammo_tech_id": tina, "case_ids": [ids[5]], "exclude": [ids[5]]}, headers=admin).json()
    assert r["assigned"] == 0 and r["not_found"] == 0


def test_assign_everything_that_matches_with_count_check(client, env):
    ids, _ = env
    admin = token("admin@test.com", "Admin")
    tina = uid("mammotech@test.com")
    page = client.get(f"{B}/cases?status=unassigned&birads=4&order=asc&page_size=2", headers=admin).json()
    assert page["page_size"] == 2 and len(page["items"]) <= 2
    n = page["assignable_total"]
    assert n >= 6 and page["total"] >= n
    ascending = [i["id"] for i in client.get(f"{B}/cases?order=asc&page_size=200", headers=admin).json()["items"]]
    assert ascending == sorted(ascending)
    # the list changed since the admin looked: refused, nothing assigned
    stale = client.post(f"{B}/assign", json={"mammo_tech_id": tina, "matching": {"status": "unassigned", "birads": "4"}, "expected_count": n + 1}, headers=admin)
    assert stale.status_code == 409 and "list changed" in stale.json()["detail"]
    assert client.get(f"{B}/cases?status=unassigned&birads=4", headers=admin).json()["assignable_total"] == n
    ok = client.post(f"{B}/assign", json={"mammo_tech_id": tina, "matching": {"status": "unassigned", "birads": "4"}, "expected_count": n}, headers=admin).json()
    assert ok["assigned"] == n and len(ok["assigned_ids"]) == n and ok["moved_from"] == {}
    after = client.get(f"{B}/cases?status=unassigned&birads=4", headers=admin).json()
    assert after["assignable_total"] == 0
    # undo = unassign what was just given
    assert client.post(f"{B}/unassign", json=ok["assigned_ids"], headers=admin).json()["unassigned"] == n


def test_reassign_reports_previous_owner_and_facets(client, env):
    ids, _ = env
    admin = token("admin@test.com", "Admin")
    tina, ravi = uid("mammotech@test.com"), _second_tech()
    client.post(f"{B}/assign", json={"mammo_tech_id": tina, "case_ids": [ids[3]]}, headers=admin)
    r = client.post(f"{B}/assign", json={"mammo_tech_id": ravi, "case_ids": [ids[3]], "reassign": True}, headers=admin).json()
    assert r["moved"] == 1 and r["moved_from"] == {str(ids[3]): tina}
    f = client.get(f"{B}/case-facets", headers=admin).json()
    assert set(f) == {"vendors", "manufacturers"}


def test_pixels_endpoint_returns_full_resolution_16bit(client, env, tmp_path, monkeypatch):
    import io
    import gzip as gz
    import numpy as np
    import pydicom
    from pydicom.dataset import Dataset, FileMetaDataset
    from pydicom.uid import ExplicitVRLittleEndian, generate_uid
    monkeypatch.setenv("RETRO_STAGING_DIR", str(tmp_path / "stage"))
    ids, _ = env
    # a small real DICOM with known pixel values
    rows, cols = 7, 5
    arr = (np.arange(rows * cols, dtype=np.uint16).reshape(rows, cols) * 300) % 4096
    meta = FileMetaDataset(); meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.1.2"; meta.MediaStorageSOPInstanceUID = generate_uid()
    ds = Dataset(); ds.file_meta = meta; ds.Rows, ds.Columns = rows, cols
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation, ds.SamplesPerPixel = 16, 12, 11, 0, 1
    ds.PhotometricInterpretation = "MONOCHROME2"; ds.PixelData = arr.tobytes()
    ds.is_little_endian, ds.is_implicit_VR = True, False
    buf = io.BytesIO(); pydicom.dcmwrite(buf, ds, write_like_original=False)
    stored = {"gs://b/p.dcm": buf.getvalue()}
    monkeypatch.setattr(intake, "read_from_gcs", lambda url: stored[url])
    db = TestSession()
    f = RetroFile(qc_case_id=ids[0], qc_kind="view", qc_view="RCC", qc_filename="p.dcm", qc_gcs_path="gs://b/p.dcm", qc_sha256="ab" * 32)
    db.add(f); db.commit(); fid = f.qc_id; db.close()
    admin, mt = token("admin@test.com", "Admin"), token("mammotech@test.com", "Mammo Tech")
    r = client.get(f"{B}/files/{fid}/pixels", headers=admin)
    assert r.status_code == 200
    got = np.frombuffer(r.content, dtype="<u2").reshape(rows, cols)   # the HTTP client already removed the gzip layer
    assert (got == arr).all()
    stored.clear()   # second request must come from the cache, not storage
    assert client.get(f"{B}/files/{fid}/pixels", headers=admin).status_code == 200
    assert client.get(f"{B}/files/{fid}/pixels", headers=mt).status_code == 404  # not assigned to this Mammo Tech


def test_large_zip_can_be_sent_in_parts(client, env, tmp_path, monkeypatch):
    monkeypatch.setenv("RETRO_STAGING_DIR", str(tmp_path / "stage"))
    admin = token("admin@test.com", "Admin")
    b = client.post(f"{B}/batches", data={"source_name": "big.zip", "vendor": "V"}, headers=admin).json()["id"]
    blob = os.urandom(2500)
    sent = 0
    for part in (blob[:1000], blob[1000:2000], blob[2000:]):
        r = client.post(f"{B}/batches/{b}/parts", data={"path": "big.zip", "offset": str(sent)},
                        files={"file": ("big.zip", part)}, headers=admin)
        assert r.status_code == 200 and r.json()["size"] == sent + len(part)
        sent += len(part)
    assert (tmp_path / "stage" / str(b) / "raw" / "big.zip").read_bytes() == blob
    # a part that does not continue where the last one ended is refused
    bad = client.post(f"{B}/batches/{b}/parts", data={"path": "big.zip", "offset": "10"}, files={"file": ("big.zip", b"x")}, headers=admin)
    assert bad.status_code == 409
    assert client.get(f"{B}/batches/{b}", headers=admin).json()["files_received"] == 1
    # paths cannot escape the staging folder
    esc = client.post(f"{B}/batches/{b}/parts", data={"path": "../x.zip", "offset": "0"}, files={"file": ("x", b"x")}, headers=admin)
    assert esc.status_code == 400


def test_radiologist_reject_then_admin_delete_keeps_counts(client, env, monkeypatch):
    from backend.src.models.retro import RetroCase as RC, RetroDeletedCase
    ids, _ = env
    removed = []
    monkeypatch.setattr(intake, "delete_blobs", lambda urls: removed.extend(urls))
    admin, mt, rad = token("admin@test.com", "Admin"), token("mammotech@test.com", "Mammo Tech"), token("radiologist@test.com", "Radiologist")
    c = ids[4]
    client.post(f"{B}/assign", json={"mammo_tech_id": uid("mammotech@test.com"), "from_case": c, "to_case": c}, headers=admin)
    client.post(f"{B}/cases/{c}/escalate", json={"note": "Not sure there is a lesion"}, headers=mt)
    before = client.get(f"{B}/tally", headers=admin).json()["rejected_by_radiologist"]

    assert client.post(f"{B}/cases/{c}/radiologist/reject", json={"note": " "}, headers=rad).status_code == 400
    assert client.post(f"{B}/cases/{c}/radiologist/reject", json={"note": "No lesion"}, headers=mt).status_code == 403
    r = client.post(f"{B}/cases/{c}/radiologist/reject", json={"note": "No lesion present"}, headers=rad)
    assert r.status_code == 200 and r.json()["status"] == "rejected"

    # gone from both work lists, never comes back to the Mammo Tech
    assert c not in [x["id"] for x in client.get(f"{B}/my-cases", headers=mt).json()]
    assert c not in [x["id"] for x in client.get(f"{B}/radiologist-cases", headers=rad).json()]
    assert client.post(f"{B}/cases/{c}/complete", headers=mt).status_code == 409

    # admin sees it, with the reason, and cannot download
    d = client.get(f"{B}/cases/{c}", headers=admin).json()
    assert d["status_label"] == "Rejected by Radiologist" and d["assignment"]["reject_reason"] == "No lesion present"
    assert client.get(f"{B}/cases/{c}/masks.zip", headers=admin).status_code == 409
    listed = client.get(f"{B}/cases?status=rejected", headers=admin).json()["items"]
    assert c in [i["id"] for i in listed]
    assert client.get(f"{B}/tally", headers=admin).json()["rejected_by_radiologist"] == before + 1

    # only rejected cases can be deleted, and only by an admin
    assert client.delete(f"{B}/cases/{ids[5]}", headers=admin).status_code == 409
    assert client.delete(f"{B}/cases/{c}", headers=mt).status_code in (401, 403)
    db = TestSession(); h = db.query(RC).filter(RC.qc_id == c).first().qc_content_hash; db.close()
    assert client.delete(f"{B}/cases/{c}", headers=admin).status_code == 200
    assert client.get(f"{B}/cases/{c}", headers=admin).status_code == 404

    # the count survives, and the same images are blocked from coming back
    t = client.get(f"{B}/tally", headers=admin).json()
    assert t["rejected_by_radiologist"] == before + 1 and t["deleted_by_admin"] >= 1
    db = TestSession()
    assert db.query(RetroDeletedCase).filter(RetroDeletedCase.qc_content_hash == h).count() == 1
    db.close()
