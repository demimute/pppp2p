"""Perceptual hash engine for DedupStudio."""

import sys
from pathlib import Path

_backend_root = Path(__file__).parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

import imagehash
from PIL import Image
from typing import List, Dict
from cache import get_cache, set_cache


def compute_hashes(images: List[str], folder: str) -> Dict[str, str]:
    """Compute pHash (perceptual hash) for a list of images.

    Args:
        images: List of image filenames (relative to folder).
        folder: Absolute path to the folder containing images.

    Returns:
        Dict mapping image name -> hex hash string.
        Results are cached in ~/.dedup-studio/cache/.
    """
    if not images:
        return {}

    folder_path = Path(folder)
    hashes: Dict[str, str] = {}

    for img_name in images:
        # Check cache (namespace: 'hash')
        cached = get_cache(folder, img_name, cache_type="hash")
        if cached is not None:
            hashes[img_name] = cached
            continue

        img_path = folder_path / img_name
        try:
            if img_path.exists() and img_path.is_file():
                img = Image.open(img_path)
                # Compute pHash (64-bit by default)
                h = imagehash.phash(img)
                hex_hash = str(h)
                hashes[img_name] = hex_hash
                set_cache(folder, img_name, hex_hash, cache_type="hash")
        except Exception:
            # Failed to hash, skip
            pass

    return hashes
