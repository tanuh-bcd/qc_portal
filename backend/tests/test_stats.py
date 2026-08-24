"""Tests for stats dashboard API endpoint.
Stats queries use MySQL-specific functions (DATE_FORMAT, CAST AS UNSIGNED)
so full integration tests are skipped on SQLite.
"""
import pytest

mysql_only = pytest.mark.skip(reason="Requires MySQL (uses DATE_FORMAT, CAST AS UNSIGNED)")


class TestStatsEndpoint:
    @mysql_only
    def test_stats_returns_200(self, client):
        res = client.get("/api/v1/stats/")
        assert res.status_code == 200

    @mysql_only
    def test_stats_structure(self, client):
        res = client.get("/api/v1/stats/")
        data = res.json()
        for key in ["totalSubjects", "institutionsEmpanelled", "riskBins", "hospitalBins", "ageBins", "monthBins"]:
            assert key in data

    @mysql_only
    def test_risk_bins_structure(self, client):
        res = client.get("/api/v1/stats/")
        for b in res.json()["riskBins"]:
            assert "name" in b and "value" in b

    @mysql_only
    def test_age_bins_all_present(self, client):
        res = client.get("/api/v1/stats/")
        names = [b["name"] for b in res.json()["ageBins"]]
        for expected in ["18-29", "30-39", "40-49", "50-59", "60-69", "70+"]:
            assert expected in names


class TestHealthEndpoint:
    def test_health_check(self, client):
        res = client.get("/api/health")
        assert res.status_code == 200
        assert res.json()["success"] is True

    def test_root_endpoint(self, client):
        res = client.get("/")
        assert res.status_code == 200
        assert "Tanuh BCD API" in res.json()["message"]
