import os

# Prevent core.config/core.secrets from making network calls to GCP Secret
# Manager for every unset env var during test collection (see
# docs/fortnightly_email_reminder_operations.md). Must be set before
# backend.src.main (and therefore backend.src.core.config) is imported.
os.environ.setdefault("DISABLE_SECRET_MANAGER", "true")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from backend.src.main import app
from backend.src.db.session import Base, get_db, get_questionnaire_db
from backend.src.core.security import get_password_hash, create_access_token

SQLALCHEMY_TEST_URL = "sqlite:///./test_bcd.db"
SQLALCHEMY_TEST_Q_URL = "sqlite:///./test_questionnaire.db"
# A handful of models (RiskCategory*, ModelWeights*, RiskThresholds*) declare
# __table_args__ = {"schema": "ai_features"}. SQLite has no notion of a
# schema on its own — it needs the schema attached as a separate database —
# so every new DBAPI connection on the main engine attaches one here, backed
# by a real file so all connections (and both the app and test code) see the
# same data.
AI_FEATURES_DB_PATH = os.path.abspath("./test_ai_features.db")

engine = create_engine(SQLALCHEMY_TEST_URL, connect_args={"check_same_thread": False})
q_engine = create_engine(SQLALCHEMY_TEST_Q_URL, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _attach_ai_features_schema(dbapi_connection, connection_record):
    dbapi_connection.execute(f"ATTACH DATABASE '{AI_FEATURES_DB_PATH}' AS ai_features")

TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
TestQSession = sessionmaker(autocommit=False, autoflush=False, bind=q_engine)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


def override_get_questionnaire_db():
    db = TestQSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="session", autouse=True)
def setup_databases():
    from backend.src.models.models import PatientResponse, EmailTemplate
    for model in [PatientResponse, EmailTemplate]:
        for col in model.__table__.columns:
            if col.name == 'qc_updated_at' and col.server_default is not None:
                col.server_default = None

    Base.metadata.create_all(bind=engine)

    from sqlalchemy import text
    conn = q_engine.connect()
    conn.execute(text("CREATE TABLE IF NOT EXISTS qc_session_table (qc_session_id TEXT PRIMARY KEY, qc_ip_address TEXT, qc_session_start_time TEXT, qc_session_end_time TEXT, qc_snehita_lifetime_risk TEXT, qc_risk_category TEXT, qc_consent_url TEXT)"))
    columns = {row[1] for row in conn.execute(text("PRAGMA table_info(qc_session_table)")).fetchall()}
    if "qc_consent_url" not in columns:
        conn.execute(text("ALTER TABLE qc_session_table ADD COLUMN qc_consent_url TEXT"))
    conn.execute(text("CREATE TABLE IF NOT EXISTS qc_session_data_table (qc_session_data_id TEXT PRIMARY KEY, qc_session_id TEXT, qc_question TEXT, qc_answer TEXT, created_by TEXT, qc_created_at TEXT)"))
    conn.commit()
    conn.close()

    _seed_test_data()

    yield
    for f in ["test_bcd.db", "test_questionnaire.db", "test_ai_features.db"]:
        if os.path.exists(f):
            os.unlink(f)


def _seed_test_data():
    from backend.src.models.models import Hospital, Role, User
    session = TestSession()
    if session.query(Hospital).first():
        session.close()
        return

    session.add(Hospital(qc_id="clinic_00001", qc_name="TestHospital", qc_contact_person="Dr. Test", qc_email="test@hospital.com"))
    session.add(Hospital(qc_id="clinic_00002", qc_name="Test", qc_contact_person="Super Admin", qc_email="super@test.com"))
    for name in ["Admin", "Radiologist"]:
        session.add(Role(qc_name=name))
    session.commit()

    admin_role = session.query(Role).filter(Role.qc_name == "Admin").first()
    radiologist_role = session.query(Role).filter(Role.qc_name == "Radiologist").first()

    session.add(User(qc_email="admin@test.com", qc_password_hash=get_password_hash("password123"), qc_hospital_id="clinic_00001", qc_role_id=admin_role.qc_id, qc_is_active=True, qc_full_name="Admin User"))
    session.add(User(qc_email="radiologist@test.com", qc_password_hash=get_password_hash("password123"), qc_hospital_id="clinic_00001", qc_role_id=radiologist_role.qc_id, qc_is_active=True, qc_full_name="Dr. Radiologist"))
    session.commit()
    session.close()


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_questionnaire_db] = override_get_questionnaire_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def seed_hospital_and_user():
    return {"hospital_id": "clinic_00001", "hospital_name": "TestHospital"}


def get_token(role="Admin", email=None, hospital_id="clinic_00001"):
    if email is None:
        email = f"{role.lower()}@test.com"
    return create_access_token(data={"sub": email, "hospital_id": hospital_id, "role": role})
