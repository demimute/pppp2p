"""Persona enhancement engine for DedupStudio.

Provides per-image "persona" feature vectors that capture lightweight
subject-identity cues from image content itself. The goal is not full face
recognition, but a cheap local signal that can help distinguish obviously
different people without adding heavy model dependencies.

Current implementation is a lightweight image-signature extractor built on
Pillow and simple numeric features. It avoids filename-derived heuristics so
that identity decisions are tied to the actual image content.
"""

import sys
from pathlib import Path

_backend_root = Path(__file__).parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

import math
from typing import Dict, List

import numpy as np
from PIL import Image, ImageOps

from cache import get_cache, set_cache


# ---------------------------------------------------------------------------
# Thresholds for Phase 1 person disambiguation
# ---------------------------------------------------------------------------

# Identity thresholds (weighted content similarity on persona vector)
IDENTITY_THRESHOLD_SAME: float = 0.92   # ≥ this → same person
IDENTITY_THRESHOLD_DIFF: float = 0.72   # ≤ this → different person
IDENTITY_THRESHOLD_UNCERTAIN: float = 0.84  # in-between → uncertain

# Pose similarity threshold
POSE_THRESHOLD_CLOSE: float = 0.80     # ≥ this → pose close
POSE_THRESHOLD_FAR: float = 0.50        # ≤ this → pose far

# Penalty applied when different-person is detected
IDENTITY_DIFF_PENALTY: float = 0.40     # subtracted from base similarity

# Boost applied when same-person AND pose-close
POSE_SAME_BOOST: float = 0.05          # added to base similarity (capped)

# Minimum persona vector quality to consider signal reliable
MIN_PERSONA_QUALITY: float = 0.05      # vectors with norm < this → unavailable


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def compute_persona_features(images: List[str], folder: str) -> Dict[str, List[float]]:
    """Compute persona feature vectors for a list of images.

    Args:
        images: List of image filenames (relative to folder).
        folder: Absolute path to the folder.

    Returns:
        Dict mapping image name -> persona feature vector (16 dims).
        Empty list for images where extraction failed.
        Results are cached under cache_type="persona".
    """
    if not images:
        return {}

    folder_path = Path(folder)
    features: Dict[str, List[float]] = {}
    uncached: List[str] = []

    for img_name in images:
        cached = get_cache(folder, img_name, cache_type="persona")
        if cached is not None:
            features[img_name] = cached
        else:
            uncached.append(img_name)

    for img_name in uncached:
        vec = _extract_persona_vec(img_name, folder_path / img_name)
        features[img_name] = vec
        set_cache(folder, img_name, vec, cache_type="persona")

    return features


def persona_similarity(a: List[float], b: List[float]) -> float:
    """Cosine similarity between two persona vectors."""
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def classify_person_identity(a: List[float], b: List[float]) -> tuple[str, float]:
    """Classify whether two persona vectors belong to the same person.

    The lightweight v1 path is intentionally stricter than raw cosine
    similarity alone. We combine overall similarity with targeted checks for
    color drift and layout drift so that "same composition, different outfit"
    does not get over-accepted as the same person.

    Returns:
        (state, score) where state ∈ {same, different, uncertain, unavailable}
        and score is the weighted identity similarity.
    """
    if not a or not b:
        return "unavailable", 0.0

    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    quality = min(norm_a, norm_b)
    if quality < MIN_PERSONA_QUALITY:
        return "unavailable", 0.0

    sim = persona_similarity(a, b)

    color_gap = max(abs(a[i] - b[i]) for i in range(6))
    profile_gap = max(abs(a[i] - b[i]) for i in range(6, 10))
    center_gap = abs(a[10] - b[10]) + abs(a[11] - b[11])
    structure_gap = max(abs(a[i] - b[i]) for i in range(12, 16))

    score = sim
    score -= min(color_gap * 0.35, 0.35)
    score -= min(profile_gap * 0.20, 0.20)
    score -= min(center_gap * 0.08, 0.08)
    score -= min(structure_gap * 0.12, 0.12)
    score = max(-1.0, min(1.0, score))

    if score >= IDENTITY_THRESHOLD_SAME:
        return "same", score
    if score <= IDENTITY_THRESHOLD_DIFF:
        return "different", score
    return "uncertain", score


def classify_pose_similarity(a: List[float], b: List[float]) -> tuple[str, float]:
    """Classify whether two persona vectors have similar pose/stance.

    Phase 1: This uses a simple heuristic on the persona vector.
    Phase 2 (future): Replace with real pose/keypoint similarity.

    Returns:
        (state, score) where state ∈ {close, far, uncertain, unavailable}.
    """
    if not a or not b:
        return "unavailable", 0.0
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if min(norm_a, norm_b) < MIN_PERSONA_QUALITY:
        return "unavailable", 0.0
    sim = persona_similarity(a, b)
    if sim >= POSE_THRESHOLD_CLOSE:
        return "close", sim
    if sim <= POSE_THRESHOLD_FAR:
        return "far", sim
    return "uncertain", sim


def compute_person_disambiguation(
    winner_persona: List[float],
    member_persona: List[float],
    base_similarity: float,
) -> dict:
    """Compute person disambiguation decision for a pair.

    Implements the three-tier decision logic:
        1. unavailable → fall back to base similarity (no adjustment)
        2. different   → strong penalty (push far below threshold)
        3. same        → apply pose refinement

    Args:
        winner_persona: 16-dim persona vector of the group winner.
        member_persona: 16-dim persona vector of the member.
        base_similarity: The raw CLIP/pHash base similarity before persona.

    Returns:
        dict with keys:
            person_identity_state: str
            person_identity_score: float
            pose_state: str
            pose_similarity: float
            person_adjustment: float   (delta applied to base similarity)
            decision_reason: str
    """
    identity_state, identity_score = classify_person_identity(
        winner_persona, member_persona
    )
    pose_state, pose_score = classify_pose_similarity(
        winner_persona, member_persona
    )

    if identity_state == "unavailable":
        adjustment = 0.0
        reason = "person_signal_unavailable_fallback_base"
    elif identity_state == "different":
        adjustment = -IDENTITY_DIFF_PENALTY
        reason = f"different_person_penalty_applied_{IDENTITY_DIFF_PENALTY}"
    elif identity_state == "same":
        if pose_state == "close":
            adjustment = POSE_SAME_BOOST
            reason = "same_person_pose_close_positive_boost"
        elif pose_state == "far":
            adjustment = -0.05
            reason = "same_person_pose_far_slight_penalty"
        else:  # uncertain
            adjustment = 0.0
            reason = "same_person_pose_uncertain_no_adjustment"
    else:  # uncertain
        adjustment = 0.0
        reason = "person_identity_uncertain_fallback_base"

    return {
        "person_identity_state": identity_state,
        "person_identity_score": round(identity_score, 4),
        "pose_state": pose_state,
        "pose_similarity": round(pose_score, 4),
        "person_adjustment": round(adjustment, 4),
        "decision_reason": reason,
    }


# ---------------------------------------------------------------------------
# Internal helpers (mock implementation)
# ---------------------------------------------------------------------------

def _extract_persona_vec(img_name: str, img_path: Path) -> List[float]:
    """Produce a 16-D lightweight image-content signature.

    The vector intentionally avoids filename or filesystem metadata so that
    person disambiguation depends on what is visible in the image:

    - 6 dims: torso/body-region color signature (mean RGB + std RGB)
    - 4 dims: luminance layout across vertical body-like regions
    - 2 dims: brightness center-of-mass (x/y)
    - 2 dims: edge density and left/right balance
    - 2 dims: aspect ratio and contrast strength

    Compared with a full-frame average, the torso-weighted color signature is
    much more sensitive to clothing differences, which is useful for a cheap
    local identity heuristic.
    """
    try:
        with Image.open(img_path) as img:
            img = ImageOps.exif_transpose(img).convert('RGB')
            img = img.resize((96, 128))
            arr = np.asarray(img, dtype=np.float32) / 255.0
    except Exception:
        return []

    if arr.size == 0:
        return []

    h, w, _ = arr.shape
    gray = arr.mean(axis=2)

    torso = arr[int(h * 0.28):int(h * 0.78), int(w * 0.22):int(w * 0.78), :]
    if torso.size == 0:
        torso = arr

    torso_means = torso.mean(axis=(0, 1))
    torso_stds = torso.std(axis=(0, 1))

    vertical_slices = np.array_split(gray, 4, axis=0)
    vertical_profile = [float(s.mean()) for s in vertical_slices]

    y_coords, x_coords = np.mgrid[0:h, 0:w]
    mass = gray.sum()
    if mass <= 1e-6:
        center_x = 0.5
        center_y = 0.5
    else:
        center_x = float((gray * x_coords).sum() / (mass * max(w - 1, 1)))
        center_y = float((gray * y_coords).sum() / (mass * max(h - 1, 1)))

    grad_x = np.abs(np.diff(gray, axis=1)).mean() if w > 1 else 0.0
    grad_y = np.abs(np.diff(gray, axis=0)).mean() if h > 1 else 0.0
    edge_density = float((grad_x + grad_y) / 2.0)

    left_mean = float(gray[:, : w // 2].mean()) if w >= 2 else float(gray.mean())
    right_mean = float(gray[:, w // 2 :].mean()) if w >= 2 else float(gray.mean())
    horizontal_balance = left_mean - right_mean

    aspect_ratio = float(w / max(h, 1))
    aspect_feature = math.tanh(aspect_ratio - 0.75)
    contrast_strength = float(gray.std())

    raw = [
        *torso_means.tolist(),
        *torso_stds.tolist(),
        *vertical_profile,
        center_x,
        center_y,
        edge_density,
        horizontal_balance,
        aspect_feature,
        contrast_strength,
    ]

    centered = []
    for idx, value in enumerate(raw):
        if idx in {11, 12, 14}:
            centered.append(float(np.clip(value, -1.0, 1.0)))
        else:
            centered.append(float(np.clip((value - 0.5) * 2.0, -1.0, 1.0)))

    return [round(x, 4) for x in centered]
