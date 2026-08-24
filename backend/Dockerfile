FROM python:3.13-slim

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/src ./src

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')" || exit 1

CMD ["gunicorn", "src.main:app", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "4", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--timeout", "300", \
     "--graceful-timeout", "30", \
     "--keep-alive", "5", \
     "--max-requests", "1000", \
     "--max-requests-jitter", "100"]
