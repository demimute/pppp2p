"""Perceptual hash engine for DedupStudio."""

import sys
from pathlib import Path

_backend_root = Path(__file__).parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import imagehash
from PIL import Image
from typing import List, Dict, Optional, Tuple
from cache import get_cache, set_cache


def _compute_single_hash(folder_path: Path, img_name: str) -> Tuple[str, Optional[str]]:
    img_path = folder_path / img_name
    try:
        if img_path.exists() and img_path.is_file():
            with Image.open(img_path) as img:
                hex_hash = str(imagehash.phash(img))
            return img_name, hex_hash
    except Exception:
        pass
    return img_name, None


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
    uncached_images: List[str] = []

    for img_name in images:
        cached = get_cache(folder, img_name, cache_type="hash")
        if cached is not None:
            hashes[img_name] = cached
        else:
            uncached_images.append(img_name)

    if not uncached_images:
        return hashes

    max_workers = min(8, max(1, (os.cpu_count() or 4)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_compute_single_hash, folder_path, img_name) for img_name in uncached_images]
        for future in as_completed(futures):
            img_name, hex_hash = future.result()
            if hex_hash is None:
                continue
            hashes[img_name] = hex_hash
            set_cache(folder, img_name, hex_hash, cache_type="hash")

    return hashes
