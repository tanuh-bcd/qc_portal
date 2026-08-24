from fastapi import FastAPI, Request
import time
import logging
from fastapi.middleware.cors import CORSMiddleware
from .core.config import settings
from .api import (
    auth,
    languages,
    patient,
    admin,
    doctor,
    jobs,
    reminders,
    stats,
    public,
    mammogram,
    risk_categories,
    model_weights,
    risk_thresholds,
)

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.PROJECT_VERSION,
)

# Middleware for timing requests
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    logger.info(f"Request: {request.method} {request.url.path} - Process Time: {process_time:.4f}s")
    return response

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Should be restricted in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth.router, prefix="/api/v1/qc/auth", tags=["auth"])
app.include_router(languages.router, prefix="/api/v1/qc/languages", tags=["languages"])
app.include_router(patient.router, prefix="/api/v1/qc/patient", tags=["patient"])
app.include_router(doctor.router, prefix="/api/v1/qc/doctor", tags=["doctor"])
app.include_router(admin.router, prefix="/api/v1/qc/admin", tags=["admin"])
app.include_router(stats.router, prefix="/api/v1/qc/stats", tags=["stats"])
app.include_router(public.router, prefix="/api/v1/qc", tags=["public"])
app.include_router(mammogram.router, prefix="/api/v1/qc/mammogram", tags=["mammogram"])
app.include_router(jobs.router, prefix="/api/internal/jobs", tags=["internal-jobs"])
app.include_router(reminders.router, prefix="/api/v1/qc/reminders", tags=["reminders"])
app.include_router(risk_categories.router, prefix="/api/v1/qc/risk-categories", tags=["risk-categories"])
app.include_router(model_weights.router, prefix="/api/v1/qc/model-weights", tags=["model-weights"])
app.include_router(risk_thresholds.router, prefix="/api/v1/qc/risk-thresholds", tags=["risk-thresholds"])


@app.get("/api/health")
def health_check():
    return {"success": True, "message": "Backend is healthy!"}

@app.get("/")
def read_root():
    return {"message": "Welcome to Tanuh BCD API"}