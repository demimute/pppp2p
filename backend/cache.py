"""Cache management for DedupStudio."""

import json
import hashlib
from pathlib import Path
from typing import Optional, Any

CACHE_DIR = Path.home() / ".dedup-studio" / "cache"


def _get_cache_path(folder: str, imagename: str, cache_type: str = "default") -> Path:
    """Get cache file path for a given folder and image.
    
    Cache path: {md5_folder}_{cache_type}_{imagename}.json
    cache_type namespaces different cache entries (e.g. 'clip' vs 'hash')
    to prevent collisions when different engines cache different data for the same image.
    """
    folder_md5 = hashlib.md5(folder.encode()).hexdigest()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    safe_type = cache_type.replace("/", "_")
    safe_name = imagename.replace("/", "_")
    return CACHE_DIR / f"{folder_md5}_{safe_type}_{safe_name}.json"


def get_cache(folder: str, imagename: str, cache_type: str = "default") -> Optional[Any]:
    """Read cached data for an image.
    
    Returns None if cache miss or invalid.
    cache_type namespaces the cache to avoid collisions between different engines
    (e.g. 'clip' for CLIP embeddings, 'hash' for pHash).
    """
    cache_path = _get_cache_path(folder, imagename, cache_type)
    if not cache_path.exists():
        return None
    try:
        with open(cache_path, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def set_cache(folder: str, imagename: str, data: Any, cache_type: str = "default") -> None:
    """Write data to cache for an image.
    
    cache_type namespaces the cache to avoid collisions between different engines.
    """
    cache_path = _get_cache_path(folder, imagename, cache_type)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(cache_path, 'w') as f:
        json.dump(data, f)


def clear_cache(folder: Optional[str] = None) -> int:
    """Clear all cache, or cache for a specific folder.
    
    Returns number of files cleared.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if folder is None:
        # Clear all
        count = 0
        for f in CACHE_DIR.iterdir():
            if f.suffix == '.json':
                f.unlink()
                count += 1
        return count
    else:
        # Clear only for this folder
        folder_md5 = hashlib.md5(folder.encode()).hexdigest()
        count = 0
        for f in CACHE_DIR.iterdir():
            if f.name.startswith(folder_md5) and f.suffix == '.json':
                f.unlink()
                count += 1
        return count
