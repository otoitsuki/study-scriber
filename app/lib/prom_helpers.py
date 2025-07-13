from prometheus_client import REGISTRY
from typing import Any

def metric_exists(name: str) -> bool:
    """判斷 default CollectorRegistry 裡是否已有同名 metric"""
    return any(m.name == name for m in REGISTRY.collect())

def safe_counter(name: str, documentation: str, labelnames: list[str] | None = None) -> Any:
    from prometheus_client import Counter
    if name in REGISTRY._names_to_collectors:
        return REGISTRY._names_to_collectors[name]
    return Counter(name, documentation, labelnames or [])

def safe_gauge(name: str, documentation: str, labelnames: list[str] | None = None) -> Any:
    from prometheus_client import Gauge
    if name in REGISTRY._names_to_collectors:
        return REGISTRY._names_to_collectors[name]
    return Gauge(name, documentation, labelnames or [])

def safe_summary(name: str, documentation: str, labelnames: list[str] | None = None) -> Any:
    from prometheus_client import Summary
    if name in REGISTRY._names_to_collectors:
        return REGISTRY._names_to_collectors[name]
    return Summary(name, documentation, labelnames or [])
