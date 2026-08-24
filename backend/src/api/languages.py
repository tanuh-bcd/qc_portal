from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..models.models import Language
from ..schemas.schemas import LanguageResponse
from typing import List

router = APIRouter()

@router.get("/", response_model=List[LanguageResponse])
def get_languages(db: Session = Depends(get_db)):
    return db.query(Language).all()
