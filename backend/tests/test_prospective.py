import os
import sys
from pathlib import Path

os.environ.setdefault("DISABLE_SECRET_MANAGER", "true")

import pytest

from backend.src.services import prospective_data as pd
from backend.tests.test_retro_assign import token

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import make_prospective_sample as sample  # noqa: E402

P = "/api/v1/qc/prospective"


@pytest.fixture
def data(tmp_path, monkeypatch):
    sample.main(tmp_path, n=150, seed=3)
    monkeypatch.setenv("PROSPECTIVE_DIR", str(tmp_path))
    monkeypatch.setenv("PROSPECTIVE_TEST_HOSPITALS_FILE", str(tmp_path / "none.csv"))      # the made-up hospitals reuse real ids
    pd.reset_cache()
    yield tmp_path
    pd.reset_cache()


def test_admin_only_and_not_configured(client, monkeypatch):
    monkeypatch.delenv("PROSPECTIVE_DIR", raising=False)
    monkeypatch.delenv("PROSPECTIVE_MASTER_URI", raising=False)
    pd.reset_cache()
    admin, mt, rad = token("admin@test.com", "Admin"), token("mammotech@test.com", "Mammo Tech"), token("radiologist@test.com", "Radiologist")
    assert client.get(f"{P}/status", headers=admin).json() == {"configured": False}
    assert client.get(f"{P}/sessions", headers=admin).status_code == 503
    for h in (mt, rad):
        assert client.get(f"{P}/sessions", headers=h).status_code == 403
        assert client.get(f"{P}/dashboard", headers=h).status_code == 403
    d = client.get(f"{P}/dashboard", headers=admin).json()
    assert d["prospective"] == {"configured": False} and "by_status" in d["retrospective"]


def test_filters_cr_dr_and_test_rows(client, data):
    admin = token("admin@test.com", "Admin")
    allr = client.get(f"{P}/sessions?page_size=200&include_test=true", headers=admin).json()
    shown = client.get(f"{P}/sessions?page_size=200", headers=admin).json()
    assert shown["total"] < allr["total"]                                   # test hospital hidden by default
    cr = client.get(f"{P}/sessions?tech=CR&page_size=200", headers=admin).json()
    dr = client.get(f"{P}/sessions?tech=DR&page_size=200", headers=admin).json()
    assert cr["total"] > 0 and dr["total"] > 0 and cr["total"] + dr["total"] == shown["total"]
    assert {i["technology"] for i in cr["items"]} == {"CR"}
    comp = client.get(f"{P}/sessions?complete=true&page_size=200", headers=admin).json()
    assert comp["total"] == comp["stats"]["complete"] > 0
    one = client.get(f"{P}/sessions?source=pilot&latest_only=true&page_size=200", headers=admin).json()
    assert {i["data_source"] for i in one["items"]} == {"pilot"}


def test_hospitals_detail_export_dashboard(client, data):
    admin = token("admin@test.com", "Admin")
    hs = client.get(f"{P}/hospitals", headers=admin).json()
    assert {h["technology"] for h in hs} == {"CR", "DR"} and all(h["hospital_id"] != "clinic_00001" for h in hs)
    sid = client.get(f"{P}/sessions?assessed=true&complete=true&page_size=1", headers=admin).json()["items"][0]["session_id"]
    det = client.get(f"{P}/sessions/{sid}", headers=admin).json()
    assert det["session"]["session_id"] == sid and len(det["files"]) >= 4 and det["answers"]
    assert client.get(f"{P}/sessions/nope", headers=admin).status_code == 404
    paths = client.get(f"{P}/export?kind=paths&complete=true", headers=admin).text.splitlines()
    assert paths and all(p.startswith("gs://breast-cancer-image-dataset/") and p.endswith(".dcm") for p in paths)
    csv_text = client.get(f"{P}/export?kind=csv&tech=CR", headers=admin).text
    assert csv_text.splitlines()[0].startswith("session_id") and len(csv_text.splitlines()) > 1
    d = client.get(f"{P}/dashboard", headers=admin).json()
    p = d["prospective"]
    assert p["configured"] and p["sessions"] > 0 and p["funnel"][0]["value"] == p["sessions"] and p["test_rows_excluded"] > 0
    assert p["funnel"][-1]["value"] == p["complete"] and "total_cases" in d["retrospective"] and "by_vendor" in d["retrospective"]


def test_cr_dr_is_the_hospitals_own_type_and_test_hospitals_come_from_the_table(client, data, tmp_path, monkeypatch):
    table = tmp_path / "test_hospitals.csv"
    table.write_text("hospital_id,hospital_name,is_test,note\nclinic_00008,B,1,\n")
    monkeypatch.setenv("PROSPECTIVE_TEST_HOSPITALS_FILE", str(table))
    pd.reset_cache()
    admin = token("admin@test.com", "Admin")
    hs = {h["hospital_id"]: h for h in client.get(f"{P}/hospitals", headers=admin).json()}
    assert hs["clinic_00005"]["technology"] == "DR" and hs["clinic_00011"]["technology"] == "CR"     # from hospital_type in the CSV
    assert "clinic_00008" not in hs                                                                # marked as test by the table
    assert hs["clinic_00005"]["unique_machines"] == 2 and set(hs["clinic_00005"]["machines"]["names"]) == {"Senographe", "Pristina"}
    assert hs["clinic_00005"]["machines"]["total"] == 2 and hs["clinic_00011"]["machines"]["unique"] == 1
    sid = client.get(f"{P}/sessions?hospital_id=clinic_00005&page_size=1", headers=admin).json()["items"][0]["session_id"]
    assert client.get(f"{P}/sessions/{sid}", headers=admin).json()["machines"]["unique"] == 2


def test_real_test_hospital_table():
    import os
    os.environ.pop("PROSPECTIVE_TEST_HOSPITALS_FILE", None)
    table = pd.hospital_table()
    assert {k for k, v in table.items() if v["is_test"]} == {"clinic_00002", "clinic_00010", "clinic_00021", "clinic_00025"}
    assert pd.technology({"hospital_type": "CR"}) == "CR" and pd.technology({"hospital_type": " dr "}) == "DR"
    assert pd.technology({"hospital_type": "", "mammo_technology": "DR"}) == "DR" and pd.technology({"hospital_type": ""}) == "Unknown"


def test_pilot_sites_are_grouped_under_their_hospital(client, tmp_path, monkeypatch):
    rows = [
        {"session_id": "s1", "data_source": "portal", "hospital_id": "clinic_00011", "hospital_name": "Sri Madhusudan Sai Institute", "hospital_type": "CR", "is_test": "0"},
        {"session_id": "s2", "data_source": "pilot", "hospital_id": "clinic_00022", "hospital_name": "Pilot Study - Sri Madhusudan Sai Institute", "hospital_type": "DR", "is_test": "0"},
        {"session_id": "s3", "data_source": "pilot", "hospital_id": "clinic_00099", "hospital_name": "Pilot Study - Nobody", "hospital_type": "DR", "is_test": "0"},
    ]
    for r in rows:
        r["_tech"] = pd.technology(r)
    groups = {g["hospital_id"]: g for g in pd.hospitals(rows)}
    assert set(groups) == {"clinic_00011", "clinic_00099"}                                   # the pilot site joined its parent; the orphan stays alone
    g = groups["clinic_00011"]
    assert g["hospital_ids"] == ["clinic_00011", "clinic_00022"] and g["sessions"] == 2 and g["portal"] == 1 and g["pilot"] == 1
    assert g["technology"] == "CR" and [s["technology"] for s in g["sites"]] == ["CR", "DR"]   # each site keeps its own CR / DR
    assert [r["session_id"] for r in pd.filter_rows(rows, hospital_id="clinic_00011,clinic_00022")] == ["s1", "s2"]
