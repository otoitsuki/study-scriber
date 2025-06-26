"""
一個簡單的依賴注入容器
"""
from typing import Dict, Any, Type, Callable

class Container:
    def __init__(self):
        self._providers: Dict[Type, Callable[[], Any]] = {}

    def register(self, type_hint: Type, provider: Callable[[], Any]):
        """註冊一個服務提供者"""
        self._providers[type_hint] = provider

    def resolve(self, type_hint: Type) -> Any:
        """解析一個服務實例"""
        provider = self._providers.get(type_hint)
        if not provider:
            raise Exception(f"No provider registered for {type_hint}")
        return provider()

# 全域容器實例
container = Container()
