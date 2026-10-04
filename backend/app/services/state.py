"""Process-wide application state: model lifecycle (load / auto-train) and status reporting."""
from __future__ import annotations

import threading
import time
import traceback
from datetime import datetime, timezone

from ..ml.pipeline import MonsoonPipeline


class AppState:
    def __init__(self) -> None:
        self.pipeline = MonsoonPipeline()
        self.status = "starting"  # starting | training | loading | warming | ready | error
        self.message = "Starting up"
        self.log: list[str] = []
        self.error: str | None = None
        self.started_at = datetime.now(timezone.utc)
        self.ready_at: datetime | None = None
        self._lock = threading.Lock()

    def say(self, msg: str) -> None:
        self.message = msg
        self.log.append(f"{datetime.now(timezone.utc).strftime('%H:%M:%S')}  {msg}")
        self.log = self.log[-40:]

    @property
    def ready(self) -> bool:
        return self.status == "ready" and self.pipeline.ready

    def initialise(self) -> None:
        """Load persisted models; train them if they do not exist (runs once, in a worker thread)."""
        try:
            self.status = "loading"
            self.say("Looking for saved models")
            if not self.pipeline.load():
                self.status = "training"
                self.say("No saved models found - training prototype models (one-off, ~1 min)")
                self.pipeline.train(progress=self.say)
            else:
                self.say("Models loaded from disk")
            self.status = "warming"
            self.say("Preparing held-out validation cache")
            from . import verification_service  # local import avoids a cycle

            verification_service.get_validation_frame()
            self.status = "ready"
            self.ready_at = datetime.now(timezone.utc)
            self.say("Ready")
        except Exception as exc:  # noqa: BLE001 - surface any startup failure through /api/health
            self.status = "error"
            self.error = f"{type(exc).__name__}: {exc}"
            self.say(f"Startup failed: {self.error}")
            traceback.print_exc()

    def start_background(self) -> None:
        threading.Thread(target=self.initialise, name="model-init", daemon=True).start()


state = AppState()
