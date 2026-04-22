"""Lightweight scene classifier for group/member display tags.

This layer is intentionally post-hoc only: it annotates images/groups with
scene labels such as screenshot / burst / chat without affecting grouping.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Dict, Iterable, List

from PIL import Image

from cache import get_cache, set_cache

SCENE_UNKNOWN = "unknown"
SCENE_SCREENSHOT = "screenshot"
SCENE_BURST = "burst"
SCENE_CHAT = "chat"

_SCENE_PRIORITY = {
    SCENE_SCREENSHOT: 3,
    SCENE_BURST: 2,
    SCENE_CHAT: 1,
    SCENE_UNKNOWN: 0,
}

_SCREENSHOT_NAME_HINTS = (
    "screenshot",
    "screen shot",
    "屏幕截图",
    "截屏",
    "截图",
)

_CHAT_NAME_HINTS = (
    "wechat",
    "weixin",
    "微信",
    "qq",
    "telegram",
    "whatsapp",
    "chat",
    "聊天",
)

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".heic", ".heif"}


def _normalize_name(name: str) -> str:
    return name.lower().strip()


def _is_screenshot_by_name(name: str) -> bool:
    lowered = _normalize_name(name)
    return any(token in lowered for token in _SCREENSHOT_NAME_HINTS)


def _is_chat_by_name(name: str) -> bool:
    lowered = _normalize_name(name)
    return any(token in lowered for token in _CHAT_NAME_HINTS)


def _looks_like_mobile_screen(width: int, height: int) -> bool:
    short_edge = min(width, height)
    long_edge = max(width, height)
    if short_edge < 700 or long_edge < 1100:
        return False
    aspect = long_edge / max(short_edge, 1)
    return 1.55 <= aspect <= 2.35


def _classify_single_image(folder: str, img_name: str) -> Dict[str, object]:
    cached = get_cache(folder, img_name, cache_type="scene_v1")
    if cached is not None:
        return cached

    path = Path(folder) / img_name
    result: Dict[str, object] = {
        "scene_type": SCENE_UNKNOWN,
        "scene_confidence": 0.0,
        "scene_signals": [],
    }

    lowered = _normalize_name(img_name)
    suffix = path.suffix.lower()
    if suffix not in _IMAGE_EXTS:
        set_cache(folder, img_name, result, cache_type="scene_v1")
        return result

    try:
        with Image.open(path) as img:
            width, height = img.size
    except Exception:
        set_cache(folder, img_name, result, cache_type="scene_v1")
        return result

    signals: List[str] = []
    scene_type = SCENE_UNKNOWN
    confidence = 0.0

    if _is_screenshot_by_name(lowered):
        signals.append("filename:screenshot")
        scene_type = SCENE_SCREENSHOT
        confidence = 0.98
    elif _looks_like_mobile_screen(width, height) and suffix == ".png":
        signals.append("shape:mobile_screen")
        signals.append("format:png")
        scene_type = SCENE_SCREENSHOT
        confidence = 0.86
    elif _is_chat_by_name(lowered):
        signals.append("filename:chat")
        scene_type = SCENE_CHAT
        confidence = 0.82

    result = {
        "scene_type": scene_type,
        "scene_confidence": round(confidence, 4),
        "scene_signals": signals,
    }
    set_cache(folder, img_name, result, cache_type="scene_v1")
    return result


def classify_image_scenes(images: Iterable[str], folder: str) -> Dict[str, Dict[str, object]]:
    return {name: _classify_single_image(folder, name) for name in images}


def classify_group_scene(member_names: Iterable[str], image_scenes: Dict[str, Dict[str, object]]) -> Dict[str, object]:
    names = [name for name in member_names if name]
    if len(names) < 2:
        return {
            "group_scene_type": SCENE_UNKNOWN,
            "group_scene_confidence": 0.0,
            "group_scene_signals": [],
        }

    member_types = [image_scenes.get(name, {}).get("scene_type", SCENE_UNKNOWN) for name in names]
    counts = Counter(scene for scene in member_types if scene != SCENE_UNKNOWN)
    if counts:
        scene_type, count = max(
            counts.items(),
            key=lambda item: (item[1], _SCENE_PRIORITY.get(item[0], 0), item[0]),
        )
        confidence = count / len(names)
    else:
        scene_type = SCENE_UNKNOWN
        confidence = 0.0

    if scene_type == SCENE_UNKNOWN and len(names) >= 3:
        scene_type = SCENE_BURST
        confidence = 0.74
        signals = [f"group:size={len(names)}", "pattern:near_duplicate_cluster"]
    else:
        signals = [
            f"member_vote:{name}:{image_scenes.get(name, {}).get('scene_type', SCENE_UNKNOWN)}"
            for name in names
            if image_scenes.get(name, {}).get("scene_type", SCENE_UNKNOWN) != SCENE_UNKNOWN
        ]

    return {
        "group_scene_type": scene_type,
        "group_scene_confidence": round(confidence, 4),
        "group_scene_signals": signals,
    }
