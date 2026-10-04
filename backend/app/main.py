"""MonsoonAI FastAPI application."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from .api.routes import router
from .config import APP_NAME, APP_TAGLINE, APP_VERSION
from .services.state import state
from .services.live_service import LiveDataError
from .services.upload_service import UploadError

log = logging.getLogger("monsoonai")


@asynccontextmanager
async def lifespan(_: FastAPI):
    state.start_background()  # load (or auto-train) models without blocking the server from answering /api/health
    yield


app = FastAPI(title=f"{APP_NAME} API", description=APP_TAGLINE, version=APP_VERSION, lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"], allow_methods=["GET", "POST"], allow_headers=["*"])


def _err(status: int, code: str, message: str, details=None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details}})


@app.exception_handler(UploadError)
async def upload_error(_: Request, exc: UploadError):
    return _err(exc.status, exc.code, exc.message, exc.details)


@app.exception_handler(LiveDataError)
async def live_error(_: Request, exc: LiveDataError):
    return _err(502, "live_data_unavailable", str(exc))


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    details = [{"field": ".".join(str(x) for x in e["loc"] if x not in ("query", "body")), "message": e["msg"]} for e in exc.errors()]
    return _err(422, "invalid_request", "; ".join(f"{d['field']}: {d['message']}" for d in details)[:300], details)


@app.exception_handler(ValueError)
async def value_error(_: Request, exc: ValueError):
    return _err(422, "invalid_request", str(exc))


@app.exception_handler(LookupError)
async def lookup_error(_: Request, exc: LookupError):
    return _err(404, "not_found", str(exc).strip("'\""))


@app.exception_handler(RuntimeError)
async def runtime_error(_: Request, exc: RuntimeError):
    return _err(503, "models_unavailable", str(exc))


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    log.exception("Unhandled error")
    return _err(500, "internal_error", "Unexpected server error - see the backend console for details.")


app.include_router(router)


@app.get("/", include_in_schema=False)
def root():
    return {"name": APP_NAME, "tagline": APP_TAGLINE, "docs": "/docs", "health": "/api/health"}
