import time, logging
logger = logging.getLogger(__name__)

class PerformanceTimer:
    """with PerformanceTimer("name"): ..."""

    def __init__(self, label: str):
        self.label = label
        self._t0: float | None = None

    def __enter__(self):
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        t_spent = (time.perf_counter() - self._t0) * 1000
        logger.debug("⏱️  %s took %.1f ms", self.label, t_spent)
