import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from ..core.config import settings

Base = declarative_base()

_connector = None


def _get_connector():
    global _connector
    if _connector is None:
        from google.cloud.sql.connector import Connector
        import google.auth

        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        _connector = Connector(credentials=credentials)
    return _connector


def _build_engine(db_name):
    if settings.USE_CLOUD_SQL_CONNECTOR and settings.CLOUD_SQL_CONNECTION_NAME:
        return _build_connector_engine(db_name)
    return _build_direct_engine(db_name)


def _build_connector_engine(db_name):
    connector = _get_connector()
    use_iam = not settings.MYSQL_PASSWORD

    def getconn():
        conn_kwargs = {
            "instance_connection_string": settings.CLOUD_SQL_CONNECTION_NAME,
            "driver": "pymysql",
            "user": settings.MYSQL_USER,
            "db": db_name,
            "enable_iam_auth": use_iam,
        }
        if not use_iam:
            conn_kwargs["password"] = settings.MYSQL_PASSWORD
        return connector.connect(**conn_kwargs)

    return create_engine(
        "mysql+pymysql://",
        creator=getconn,
        pool_size=3,
        max_overflow=5,
        pool_pre_ping=True,
        pool_recycle=1800,
        pool_timeout=30,
    )


def _build_direct_engine(db_name):
    import urllib.parse
    connect_args = {}
    ssl_config = {}

    def is_valid_file(path):
        return path and os.path.isfile(path) and os.path.getsize(path) > 10

    if settings.MYSQL_SSL_CA and is_valid_file(settings.MYSQL_SSL_CA):
        ssl_config["ca"] = settings.MYSQL_SSL_CA
    if settings.MYSQL_SSL_CERT and is_valid_file(settings.MYSQL_SSL_CERT):
        ssl_config["cert"] = settings.MYSQL_SSL_CERT
    if settings.MYSQL_SSL_KEY and is_valid_file(settings.MYSQL_SSL_KEY):
        ssl_config["key"] = settings.MYSQL_SSL_KEY

    connect_args["ssl"] = ssl_config
    if ssl_config:
        ssl_config["check_hostname"] = False

    password = urllib.parse.quote_plus(settings.MYSQL_PASSWORD) if settings.MYSQL_PASSWORD else ""
    url = f"mysql+pymysql://{settings.MYSQL_USER}:{password}@{settings.MYSQL_HOST}:{settings.MYSQL_PORT}/{db_name}"
    if settings.MYSQL_QUERY:
        url += f"?{settings.MYSQL_QUERY}"

    return create_engine(
        url,
        connect_args=connect_args,
        pool_size=3,
        max_overflow=5,
        pool_pre_ping=True,
        pool_recycle=1800,
        pool_timeout=30,
    )


# Clinician DB (bcd_application2)
engine = _build_engine(settings.MYSQL_DB)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Questionnaire DB (bcd_questionnaire)
questionnaire_engine = _build_engine(settings.MYSQL_DB_QUESTIONNAIRE)
QuestionnaireSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=questionnaire_engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_questionnaire_db():
    db = QuestionnaireSessionLocal()
    try:
        yield db
    finally:
        db.close()
