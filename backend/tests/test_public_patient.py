"""Tests for public patient UI endpoints: session start, questionnaire submit, risk calculation."""
import pytest
import json


class TestSessionStart:
    def test_creates_session(self, client):
        res = client.post("/api/session/start")
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert "sessionId" in data
        assert len(data["sessionId"]) == 36  # UUID format

    def test_multiple_sessions(self, client):
        ids = set()
        for _ in range(5):
            res = client.post("/api/session/start")
            ids.add(res.json()["sessionId"])
        assert len(ids) == 5  # all unique


class TestQuestionnaireSubmit:
    def test_submit_basic(self, client):
        session_res = client.post("/api/session/start")
        session_id = session_res.json()["sessionId"]

        res = client.post("/api/submit", json={
            "sessionId": session_id,
            "formDataEn": {
                "Q1": "45",
                "Q10": "13",
                "Q14": "Yes",
                "Q16": "Before 24",
                "Q17": "less than 24 months",
                "Q21": "Second Order",
                "Q40": "No"
            }
        })
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert "riskPercentage" in data
        assert float(data["riskPercentage"]) > 0

    def test_submit_missing_session_id(self, client):
        res = client.post("/api/submit", json={
            "sessionId": "",
            "formDataEn": {"Q1": "30"}
        })
        assert res.status_code == 400

    def test_submit_missing_form_data(self, client):
        res = client.post("/api/submit", json={
            "sessionId": "some-id"
        })
        assert res.status_code == 422

    def test_submit_high_risk_profile(self, client):
        session_res = client.post("/api/session/start")
        session_id = session_res.json()["sessionId"]

        res = client.post("/api/submit", json={
            "sessionId": session_id,
            "formDataEn": {
                "Q1": "55",
                "Q10": "10",
                "Q12_Current": "No",
                "Q14": "No",
                "Q17": "less than 24 months",
                "Q21": "First Order (Mother, Sibling, Father)",
                "Q40": "Yes"
            }
        })
        data = res.json()
        assert float(data["riskPercentage"]) > 50  # high risk inputs

    def test_submit_low_risk_profile(self, client):
        session_res = client.post("/api/session/start")
        session_id = session_res.json()["sessionId"]

        res = client.post("/api/submit", json={
            "sessionId": session_id,
            "formDataEn": {
                "Q1": "30",
                "Q10": "14",
                "Q12_Current": "Yes",
                "Q14": "Yes",
                "Q16": "Before 24",
                "Q17": "greater than 24 months",
                "Q21": "No",
                "Q40": "No"
            }
        })
        data = res.json()
        assert float(data["riskPercentage"]) < 30  # low risk inputs


class TestRiskCalculation:
    """Unit tests for the Snehitha risk formula."""

    def test_import(self):
        from backend.src.api.public import calculate_snehitha_risk
        result = calculate_snehitha_risk({"Q1": "40"})
        assert float(result) > 0

    def test_age_increases_risk(self):
        from backend.src.api.public import calculate_snehitha_risk
        young = float(calculate_snehitha_risk({"Q1": "25"}))
        old = float(calculate_snehitha_risk({"Q1": "60"}))
        assert old > young

    def test_breastfeeding_decreases_risk(self):
        from backend.src.api.public import calculate_snehitha_risk
        base = {"Q1": "40", "Q10": "13"}
        no_bf = float(calculate_snehitha_risk({**base, "Q17": "less than 24 months"}))
        bf = float(calculate_snehitha_risk({**base, "Q17": "greater than 24 months"}))
        assert bf < no_bf

    def test_biopsy_increases_risk(self):
        from backend.src.api.public import calculate_snehitha_risk
        base = {"Q1": "40", "Q10": "13"}
        no_biopsy = float(calculate_snehitha_risk({**base, "Q40": "No"}))
        biopsy = float(calculate_snehitha_risk({**base, "Q40": "Yes"}))
        assert biopsy > no_biopsy

    def test_family_history_increases_risk(self):
        from backend.src.api.public import calculate_snehitha_risk
        base = {"Q1": "40", "Q10": "13"}
        no_fh = float(calculate_snehitha_risk({**base, "Q21": "No"}))
        fh = float(calculate_snehitha_risk({**base, "Q21": "First Order (Mother, Sibling, Father)"}))
        assert fh > no_fh

    def test_empty_input_no_crash(self):
        from backend.src.api.public import calculate_snehitha_risk
        result = calculate_snehitha_risk({})
        assert float(result) >= 0
