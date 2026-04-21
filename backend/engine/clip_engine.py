"""CLIP embedding engine for DedupStudio."""

import os
import sys
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Add backend parent to path so we can import backend modules
_backend_root = Path(__file__).parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

import torch
import open_clip
from PIL import Image
from typing import List, Dict, Optional, Tuple
from cache import get_cache, set_cache

# Determine device: MPS (Apple Silicon) > CPU
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

# Global model cache
_model = None
_preprocess = None
_model_ready = False


def _load_and_preprocess_image(args: Tuple[Path, str, any]) -> Optional[Tuple[str, torch.Tensor]]:
    path, name, preprocess = args
    try:
        if path.exists() and path.is_file():
            with Image.open(path) as img:
                rgb = img.convert("RGB")
                tensor = preprocess(rgb)
            return name, tensor
    except Exception:
        pass
    return None


def _warmup_model(model):
    global _model_ready
    if _model_ready:
        return
    with torch.no_grad():
        dummy = torch.zeros((1, 3, 224, 224), device=DEVICE)
        _ = model.encode_image(dummy)
    _model_ready = True


def _get_model():
    """Get or create the CLIP model (cached globally)."""
    global _model, _preprocess
    if _model is None:
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=r"QuickGELU mismatch.*",
                category=UserWarning,
            )
            model, _, preprocess = open_clip.create_model_and_transforms(
                "ViT-B/32",
                pretrained="openai",
                device=DEVICE,
            )
        _model = model
        _preprocess = preprocess
        _warmup_model(_model)
    return _model, _preprocess


def compute_embeddings(images: List[str], folder: str) -> Dict[str, List[float]]:
    """Compute CLIP embeddings for a list of images.

    Args:
        images: List of image filenames (relative to folder).
        folder: Absolute path to the folder containing images.

    Returns:
        Dict mapping image name -> embedding vector (512 dims).
        Only returns embeddings for images that were successfully computed.
        Results are cached in ~/.dedup-studio/cache/.
    """
    if not images:
        return {}

    model, preprocess = _get_model()
    model.eval()

    folder_path = Path(folder)
    embeddings: Dict[str, List[float]] = {}
    uncached_images = []

    # Check cache first (namespace: 'clip')
    for img_name in images:
        cached = get_cache(folder, img_name, cache_type="clip")
        if cached is not None:
            embeddings[img_name] = cached
        else:
            uncached_images.append(img_name)

    # Compute embeddings in batches. MPS benefits from moderately larger batches.
    batch_size = 24 if DEVICE == "mps" else 16
    for batch_start in range(0, len(uncached_images), batch_size):
        batch_names = uncached_images[batch_start:batch_start + batch_size]
        batch_paths = [folder_path / name for name in batch_names]

        # Load and preprocess images in parallel so model time is not blocked on decode.
        decode_workers = min(8, max(1, (os.cpu_count() or 4)))
        with ThreadPoolExecutor(max_workers=decode_workers) as executor:
            decoded = list(executor.map(
                _load_and_preprocess_image,
                [(path, name, preprocess) for name, path in zip(batch_names, batch_paths)],
            ))

        valid_items = [item for item in decoded if item is not None]
        if not valid_items:
            continue

        valid_names = [name for name, _tensor in valid_items]
        images_to_process = [tensor for _name, tensor in valid_items]

        # Stack into a batch
        batch_tensor = torch.stack(images_to_process).to(DEVICE, non_blocking=(DEVICE != "cpu"))

        with torch.no_grad():
            features = model.encode_image(batch_tensor)
            # Normalize embeddings
            features = features / features.norm(dim=-1, keepdim=True)

        # Convert to list and store (namespace: 'clip')
        for name, emb in zip(valid_names, features.cpu().tolist()):
            embeddings[name] = emb
            set_cache(folder, name, emb, cache_type="clip")

    return embeddings
