"""Convert canonical BCP-47 lang_code ⇄ provider-specific code."""

_CANONICAL_TO_SHORT = {
    "zh-TW": "zh",
    "zh":    "zh",
    "en-US": "en",
    "en":    "en",
}

def to_whisper(code: str) -> str:
    """Whisper 端點語言碼（ISO-639-1，小寫；未知→'auto')."""
    return _CANONICAL_TO_SHORT.get(code, "auto")

def to_gpt4o(code: str) -> str:
    """GPT-4o speech-transcribe 語言碼（同 Whisper）"""
    return _CANONICAL_TO_SHORT.get(code, "auto")
