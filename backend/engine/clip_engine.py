"""CLIP embedding engine for DedupStudio."""

import logging
import os
import sys
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import List, Dict, Optional, Tuple

# Add backend parent to path so we can import backend modules
_backend_root = Path(__file__).parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

import torch
import open_clip
from PIL import Image
from cache import get_cache, set_cache

# Determine device: MPS (Apple Silicon) > CPU
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

warnings.filterwarnings(
    "ignore",
    message=r"Warning: You are sending unauthenticated requests to the HF Hub.*",
)
logging.getLogger("huggingface_hub.utils._http").setLevel(logging.ERROR)

# Global model cache
_model = None
_preprocess = None
_model_ready = False
MODEL_NAME = "ViT-B-32"
PRETRAINED_TAG = "openai"
def _bundled_model_candidates() -> list[Path]:
    candidates: list[Path] = []
    exe_dir = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else None
    if exe_dir is not None:
        candidates.extend([
            exe_dir / 'model' / 'open_clip_model.safetensors',
            exe_dir.parent / 'model' / 'open_clip_model.safetensors',
            exe_dir / '_internal' / 'model' / 'open_clip_model.safetensors',
        ])
    meipass = getattr(sys, '_MEIPASS', None)
    if meipass:
        candidates.append(Path(meipass) / 'model' / 'open_clip_model.safetensors')
    return candidates


LOCAL_MODEL_CANDIDATES = [
    *_bundled_model_candidates(),
    Path.home() / '.cache' / 'huggingface' / 'hub' / 'models--timm--vit_base_patch32_clip_224.openai',
]


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


def _resolve_local_pretrained_path() -> Path:
    for repo_dir in LOCAL_MODEL_CANDIDATES:
        if not repo_dir.exists():
            continue

        if repo_dir.is_file() and repo_dir.name in {
            'open_clip_pytorch_model.bin',
            'pytorch_model.bin',
            'model.safetensors',
            'open_clip_model.safetensors',
        }:
            return repo_dir

        snapshots_dir = repo_dir / 'snapshots'
        if snapshots_dir.exists():
            for snapshot in sorted(snapshots_dir.iterdir(), reverse=True):
                for candidate in (
                    snapshot / 'open_clip_pytorch_model.bin',
                    snapshot / 'pytorch_model.bin',
                    snapshot / 'model.safetensors',
                    snapshot / 'open_clip_model.safetensors',
                ):
                    if candidate.exists() and candidate.is_file():
                        return candidate

        for candidate in repo_dir.rglob('*'):
            if candidate.is_file() and candidate.name in {
                'open_clip_pytorch_model.bin',
                'pytorch_model.bin',
                'model.safetensors',
                'open_clip_model.safetensors',
            }:
                return candidate

    raise RuntimeError(
        '本地 CLIP 权重缺失。当前已禁用运行时联网下载，请先在本机缓存 ViT-B-32/openai 权重。'
    )


def _get_model():
    """Get or create the CLIP model (cached globally)."""
    global _model, _preprocess
    if _model is None:
        local_pretrained = _resolve_local_pretrained_path()
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=r"QuickGELU mismatch.*",
                category=UserWarning,
            )
            model, _, preprocess = open_clip.create_model_and_transforms(
                MODEL_NAME,
                pretrained=str(local_pretrained),
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
