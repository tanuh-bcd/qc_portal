import os
import logging

logger = logging.getLogger(__name__)

_client = None
_cache = {}

GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "bcd-prototypes")
SECRET_PREFIX = os.getenv("SECRET_PREFIX", "bcd-")


def _get_client():
    global _client
    if _client is None:
        from google.cloud import secretmanager
        _client = secretmanager.SecretManagerServiceClient()
    return _client


def get_secret(name: str, default: str = "") -> str:
    if os.getenv("DISABLE_SECRET_MANAGER", "").lower() == "true":
        return default
    if name in _cache:
        return _cache[name]
    try:
        client = _get_client()
        secret_path = f"projects/{GCP_PROJECT_ID}/secrets/{SECRET_PREFIX}{name}/versions/latest"
        response = client.access_secret_version(name=secret_path)
        value = response.payload.data.decode("UTF-8").strip()
        _cache[name] = value
        return value
    except Exception as e:
        logger.debug("Secret Manager lookup failed for %s: %s", name, e)
        return default
