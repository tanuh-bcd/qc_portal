import os
import urllib.parse
from dotenv import load_dotenv
from .secrets import get_secret

load_dotenv()


def _cfg(name: str, default: str = "") -> str:
    return os.getenv(name) or get_secret(name, default)


class Settings:
    PROJECT_NAME: str = "Tanuh BCD API"
    PROJECT_VERSION: str = "1.0.0"

    MYSQL_USER: str = _cfg("MYSQL_USER")
    MYSQL_PASSWORD: str = _cfg("MYSQL_PASSWORD")
    MYSQL_HOST: str = _cfg("MYSQL_HOST")
    MYSQL_PORT: str = _cfg("MYSQL_PORT", "3306")
    MYSQL_DB: str = _cfg("MYSQL_DB")
    MYSQL_QUERY: str = _cfg("MYSQL_QUERY")
    MYSQL_SSL_CA: str = _cfg("MYSQL_SSL_CA")
    MYSQL_SSL_CERT: str = _cfg("MYSQL_SSL_CERT")
    MYSQL_SSL_KEY: str = _cfg("MYSQL_SSL_KEY")

    @property
    def DATABASE_URL(self) -> str:
        password = urllib.parse.quote_plus(self.MYSQL_PASSWORD) if self.MYSQL_PASSWORD else ""
        url = f"mysql+pymysql://{self.MYSQL_USER}:{password}@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DB}"
        if self.MYSQL_QUERY:
            url += f"?{self.MYSQL_QUERY}"
        return url

    SECRET_KEY: str = _cfg("SECRET_KEY")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    GCP_STORAGE_BUCKET: str = _cfg("GCP_STORAGE_BUCKET")

    CLOUD_SQL_CONNECTION_NAME: str = _cfg("CLOUD_SQL_CONNECTION_NAME")
    USE_CLOUD_SQL_CONNECTOR: bool = _cfg("USE_CLOUD_SQL_CONNECTOR", "false").lower() == "true"

    SMTP_HOST: str = _cfg("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT: int = int(_cfg("SMTP_PORT", "587"))
    SMTP_USER: str = _cfg("SMTP_USER")
    SMTP_PASSWORD: str = _cfg("SMTP_PASSWORD")
    SMTP_FROM: str = _cfg("SMTP_FROM")

    REMINDER_EMAIL_ENABLED: bool = _cfg("REMINDER_EMAIL_ENABLED", "false").lower() == "true"
    REMINDER_RECIPIENT_EMAIL: str = _cfg("REMINDER_RECIPIENT_EMAIL", "")
    REMINDER_FROM_EMAIL: str = _cfg(
        "REMINDER_FROM_EMAIL",
        "PinkShieldAI <breastcancerscreening@tanuh.ai>",
    )
    REMINDER_QUARTERLY_TARGET: int = int(_cfg("REMINDER_QUARTERLY_TARGET", "200"))
    REMINDER_INTERVAL_DAYS: int = int(_cfg("REMINDER_INTERVAL_DAYS", "14"))
    REMINDER_INTERVAL_MINUTES: int = int(_cfg("REMINDER_INTERVAL_MINUTES", "0"))
    REMINDER_PORTAL_URL: str = _cfg("REMINDER_PORTAL_URL", "https://bc-portal-dev.tanuh.ai/login")
    REMINDER_SUPPORT_EMAIL: str = _cfg("REMINDER_SUPPORT_EMAIL", "")
    REMINDER_REPLY_TO: str = _cfg("REMINDER_REPLY_TO", "")
    REMINDER_TIMEZONE: str = _cfg("REMINDER_TIMEZONE", "Asia/Kolkata")
    REMINDER_EXCLUDED_HOSPITALS: str = _cfg(
        "REMINDER_EXCLUDED_HOSPITALS",
        "Test,Tanuh Foundation",
    )
    REMINDER_EXCLUDED_RECIPIENT_DOMAINS: str = _cfg(
        "REMINDER_EXCLUDED_RECIPIENT_DOMAINS",
        "tanuh.ai",
    )
    REMINDER_CC_EMAILS: str = _cfg(
        "REMINDER_CC_EMAILS",
        "bcs@tanuh.ai",
    )
    REMINDER_AGGREGATE_RECIPIENTS: str = _cfg(
        "REMINDER_AGGREGATE_RECIPIENTS",
        (
            "ashwin.rajkumar@tanuh.ai,vaishnavi.joshi@tanuh.ai,"
            "palivela.sanjana@tanuh.ai,manisha.verma@tanuh.ai,"
            "bharath.tangella@tanuh.ai,phaneendra.yalavarthy@tanuh.ai"
        ),
    )
    REMINDER_OPERATOR_EMAILS: str = _cfg(
        "REMINDER_OPERATOR_EMAILS",
        (
            "bharath.tangella@tanuh.ai,ashwin.rajkumar@tanuh.ai,"
            "vaishnavi.joshi@tanuh.ai,palivela.sanjana@tanuh.ai"
        ),
    )
    REMINDER_LOG_RETENTION_DAYS: int = int(_cfg("REMINDER_LOG_RETENTION_DAYS", "365"))
    REMINDER_MAX_DELIVERY_ATTEMPTS: int = int(
        _cfg("REMINDER_MAX_DELIVERY_ATTEMPTS", "3")
    )
    REMINDER_FAILURE_RECIPIENT_EMAIL: str = _cfg(
        "REMINDER_FAILURE_RECIPIENT_EMAIL",
        "vaishnavi.joshi@tanuh.ai",
    )
    REMINDER_TEMPLATE_TEST_ENABLED: bool = (
        _cfg("REMINDER_TEMPLATE_TEST_ENABLED", "false").lower() == "true"
    )

    CRON_OIDC_AUDIENCE: str = _cfg("CRON_OIDC_AUDIENCE")
    CRON_SERVICE_ACCOUNT_EMAIL: str = _cfg("CRON_SERVICE_ACCOUNT_EMAIL")
    CRON_SHARED_SECRET: str = _cfg("CRON_SHARED_SECRET")

    MYSQL_DB_QUESTIONNAIRE: str = _cfg("MYSQL_DB_QUESTIONNAIRE", "bcd_questionnaire")
    MYSQL_DB_QC: str = _cfg("MYSQL_DB_QC", "qc_bcd_portal")
    QC_DATABASE_URL_OVERRIDE: str = _cfg("QC_DATABASE_URL", "")

    @property
    def QC_DATABASE_URL(self) -> str:
        if self.QC_DATABASE_URL_OVERRIDE:
            return self.QC_DATABASE_URL_OVERRIDE
        password = urllib.parse.quote_plus(self.MYSQL_PASSWORD) if self.MYSQL_PASSWORD else ""
        url = f"mysql+pymysql://{self.MYSQL_USER}:{password}@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DB_QC}"
        if self.MYSQL_QUERY:
            url += f"?{self.MYSQL_QUERY}"
        return url


settings = Settings()