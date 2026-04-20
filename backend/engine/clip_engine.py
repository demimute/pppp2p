"""CLIP embedding engine for DedupStudio."""

import sys
from pathlib import Path

# Add backend parent to path so we can import backend modules
_backend_root = Path(__file__).parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

import torch
import open_clip
from PIL import Image
from typing import List, Dict
from cache import get_cache, set_cache

# Determine device: MPS (Apple Silicon) > CPU
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

# Global model cache
_model = None
_preprocess = None


def _get_model():
    """Get or create the CLIP model (cached globally)."""
    global _model, _preprocess
    if _model is None:
        model, _, preprocess = open_clip.create_model_and_transforms(
            "ViT-B/32",
            pretrained="openai",
            device=DEVICE,
        )
        _model = model
        _preprocess = preprocess
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

    # Compute embeddings in batches of 10
    batch_size = 10
    for batch_start in range(0, len(uncached_images), batch_size):
        batch_names = uncached_images[batch_start:batch_start + batch_size]
        batch_paths = [folder_path / name for name in batch_names]

        # Load and preprocess images
        images_to_process = []
        valid_names = []
        for name, path in zip(batch_names, batch_paths):
            try:
                if path.exists() and path.is_file():
                    img = Image.open(path).convert("RGB")
                    images_to_process.append(preprocess(img))
                    valid_names.append(name)
            except Exception:
                pass

        if not images_to_process:
            continue

        # Stack into a batch
        batch_tensor = torch.stack(images_to_process).to(DEVICE)

        with torch.no_grad():
            features = model.encode_image(batch_tensor)
            # Normalize embeddings
            features = features / features.norm(dim=-1, keepdim=True)

        # Convert to list and store (namespace: 'clip')
        for name, emb in zip(valid_names, features.cpu().tolist()):
            embeddings[name] = emb
            set_cache(folder, name, emb, cache_type="clip")

    return embeddings
