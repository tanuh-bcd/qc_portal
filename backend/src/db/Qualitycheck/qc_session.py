from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from ...core.config import settings

qc_engine = create_engine(settings.QC_DATABASE_URL, pool_pre_ping=True)
QcSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=qc_engine)

def get_qc_db():
    db = QcSessionLocal()
    try:
        yield db
    finally:
        db.close()