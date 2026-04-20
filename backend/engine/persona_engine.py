"""Persona enhancement engine for DedupStudio.

Provides per-image "persona" feature vectors that capture lightweight
subject-identity cues from image content itself. The goal is not full face
recognition, but a cheap local signal that can help distinguish obviously
different people without adding heavy model dependencies.

=== Identity v2 Key Improvements over v1 ===

Problem: v1 uses global torso statistics that wash out local identity
differences. Two people using the same pose template produce nearly
identical torso color averages, causing false same-person classifications.

Solution: v2 adds explicit local region features:
- Head/skin region independently detected and compared
- Torso split into 2x2 sub-blocks (upper-left/right, lower-left/right)
  to capture clothing and accessory differences that are localized
- Foreground mask quality signal to detect when the "person region"
  is too ambiguous to be useful

The feature vector grows to 24 dims but the interface stays the same,
and classify_person_identity uses the v2 structure-aware features to
make better decisions on same-template/different-person cases.
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

    v2 feature structure (24 dims):
    - 0-3:   torso global color (R, G, B, Saturation)             [4]
    - 4-6:   head skin (brightness, sat, coverage)                [3]
    - 7-10:  torso 2x2 block luminance (UL, UR, LL, LR)           [4]
    - 11:    torso block color variance                           [1]
    - 12:    head-to-torso brightness gap                         [1]
    - 13-16: torso mask coverage stats                           [4]
    - 17-20: luminance vertical profile                           [4]
    - 21-22: center of mass (x, y)                               [2]
    - 23:    edge density                                         [1]

    The v2 classifier focuses on identity-critical dimensions:
    head-skin tone (4-6) and torso block luminances (7-10), since these
    are the most discriminative for same-template/different-person cases.

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

    # Head-skin gap: dims 4-6 (brightness, sat, coverage) - most important for identity
    head_brightness_gap = abs(a[4] - b[4])
    head_sat_gap = abs(a[5] - b[5])
    head_coverage_gap = abs(a[6] - b[6])

    # Torso block luminance gap: dims 7-10 - key for same-template/different-person
    torso_ul_gap = abs(a[7] - b[7])
    torso_ur_gap = abs(a[8] - b[8])
    torso_ll_gap = abs(a[9] - b[9])
    torso_lr_gap = abs(a[10] - b[10])
    torso_block_gap = max(torso_ul_gap, torso_ur_gap, torso_ll_gap, torso_lr_gap)

    # Torso global color gap: dims 0-3 (R, G, B, sat)
    torso_color_gap = max(abs(a[i] - b[i]) for i in range(4))

    # Head-torso gap change: dim 12
    head_torso_gap_diff = abs(abs(a[12]) - abs(b[12]))

    # Apply v2-specific penalties focused on discriminative signals
    score = sim
    # Head-skin: primary identity signal (skin tone is hard to to spoof)
    score -= min(head_brightness_gap * 0.25, 0.25)
    score -= min(head_sat_gap * 0.20, 0.20)
    score -= min(head_coverage_gap * 0.15, 0.15)
    # Torso blocks: per-region clothing/accessory differences
    score -= min(torso_block_gap * 0.30, 0.30)
    # Torso global color: strong signal for same-template/different-person
    # (e.g. red shirt vs purple shirt = different person even if same pose)
    score -= min(torso_color_gap * 0.40, 0.40)
    # Head-torso gap change
    score -= min(head_torso_gap_diff * 0.10, 0.10)

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
    """Produce a 24-D lightweight image-content signature (v2).

    v2 improves on v1 by adding explicit local region features so that
    same-template/different-person images (e.g. same pose, different person)
    produce discriminably different vectors even when their global torso
    color averages are nearly identical.

    24-dim layout:
    - Dims 0-3:  foreground torso global color (R, G, B, Saturation)     [4]
    - Dims 4-6:  head/skin region (brightness, sat, skin_coverage)         [3]
    - Dims 7-10: torso 2x2 block luminance (UL, UR, LL, LR)              [4]
    - Dim  11:   torso block color variance (intra-block spread)          [1]
    - Dim  12:   head-to-torso brightness gap                             [1]
    - Dims 13-16: torso mask coverage stats                              [4]
    - Dims 17-20: luminance vertical profile (4 slices)                  [4]
    - Dims 21-22: brightness center-of-mass (x, y)                      [2]
    - Dim  23:   edge density                                            [1]
    Total: 24 dims
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

    # --- Head region (skin tone detection) ---
    head_top = int(h * 0.05)
    head_bot = int(h * 0.32)
    head_left = int(w * 0.20)
    head_right = int(w * 0.80)
    head_region = arr[head_top:head_bot, head_left:head_right, :]
    head_gray = head_region.mean(axis=2) if head_region.size > 0 else gray[:int(h*0.3), :]
    head_sat_img = (head_region.max(axis=2) - head_region.min(axis=2)) if head_region.size > 0 else gray[:int(h*0.3), :] * 0
    skin_brightness = float(head_gray.mean()) if head_gray.size > 0 else 0.5
    skin_sat = float(head_sat_img.mean()) if head_sat_img.size > 0 else 0.0
    skin_like = (head_sat_img < 0.12) & (head_gray > 0.35) & (head_gray < 0.88)
    skin_coverage = float(skin_like.mean()) if skin_like.size > 0 else 0.0

    # --- Torso region ---
    torso = arr[int(h * 0.24):int(h * 0.82), int(w * 0.18):int(w * 0.82), :]
    if torso.size == 0:
        torso = arr

    th, tw, _ = torso.shape
    torso_gray = torso.mean(axis=2)
    torso_max = torso.max(axis=2)
    torso_min = torso.min(axis=2)
    torso_sat = torso_max - torso_min
    edge_x = np.abs(np.diff(torso_gray, axis=1, prepend=torso_gray[:, :1]))
    edge_y = np.abs(np.diff(torso_gray, axis=0, prepend=torso_gray[:1, :]))
    edge_mag = (edge_x + edge_y) * 0.5

    yy, xx = np.mgrid[0:th, 0:tw]
    cy = (th - 1) / 2.0 if th > 1 else 0.0
    cx = (tw - 1) / 2.0 if tw > 1 else 0.0
    center_bias = np.exp(-(((yy - cy) / max(th * 0.38, 1.0)) ** 2 + ((xx - cx) / max(tw * 0.32, 1.0)) ** 2))

    sat_norm = torso_sat / max(float(torso_sat.max()), 1e-6)
    edge_norm = edge_mag / max(float(edge_mag.max()), 1e-6)
    mask = 0.50 * center_bias + 0.30 * sat_norm + 0.20 * edge_norm
    mask = np.clip(mask, 0.0, 1.0)
    mask_sum = float(mask.sum())
    if mask_sum <= 1e-6:
        mask = np.ones((th, tw), dtype=np.float32)
        mask_sum = float(mask.sum())

    fg_r = float((torso[..., 0] * mask).sum() / mask_sum)
    fg_g = float((torso[..., 1] * mask).sum() / mask_sum)
    fg_b = float((torso[..., 2] * mask).sum() / mask_sum)
    fg_sat = float((torso_sat * mask).sum() / mask_sum)

    # --- 2x2 torso block luminance (key v2 addition for local discrimination) ---
    mid_h = max(th // 2, 1)
    mid_w = max(tw // 2, 1)
    ul_lum = float(torso[:mid_h, :mid_w, :].mean()) if torso[:mid_h, :mid_w, :].size > 0 else 0.5
    ur_lum = float(torso[:mid_h, mid_w:, :].mean()) if torso[:mid_h, mid_w:, :].size > 0 else 0.5
    ll_lum = float(torso[mid_h:, :mid_w, :].mean()) if torso[mid_h:, :mid_w, :].size > 0 else 0.5
    lr_lum = float(torso[mid_h:, mid_w:, :].mean()) if torso[mid_h:, mid_w:, :].size > 0 else 0.5

    # Intra-torso color variance: std of per-pixel RGB deviations from block means
    block_means = np.full((th, tw, 3), 0.5, dtype=np.float32)
    block_means[:mid_h, :mid_w, :] = ul_lum
    block_means[:mid_h, mid_w:, :] = ur_lum
    block_means[mid_h:, :mid_w, :] = ll_lum
    block_means[mid_h:, mid_w:, :] = lr_lum
    torso_color_var = float(((torso - block_means) ** 2).mean())

    # Head-to-torso brightness gap
    torso_brightness = float(torso_gray.mean()) if torso_gray.size > 0 else 0.5
    head_torso_gap = skin_brightness - torso_brightness

    hard_mask = mask > 0.55
    coverage = float(hard_mask.mean())
    upper = hard_mask[: max(th // 2, 1), :]
    lower = hard_mask[max(th // 2, 1):, :] if th > 1 else hard_mask
    left = hard_mask[:, : max(tw // 2, 1)]
    right = hard_mask[:, max(tw // 2, 1):] if tw > 1 else hard_mask
    upper_cov = float(upper.mean()) if upper.size else coverage
    lower_cov = float(lower.mean()) if lower.size else coverage
    left_cov = float(left.mean()) if left.size else coverage
    right_cov = float(right.mean()) if right.size else coverage

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

    # Build 24-dim vector
    # Signed dims (keep sign): coverage balance(13,14), vertical(15,16), head-gap(12), torso-var(11)
    raw = [
        fg_r, fg_g, fg_b, fg_sat,                # 0-3: torso global color
        skin_brightness, skin_sat, skin_coverage,  # 4-6: head skin
        ul_lum, ur_lum, ll_lum, lr_lum,           # 7-10: torso 2x2 block luminance
        torso_color_var,                           # 11: intra-block color variance (signed ok)
        head_torso_gap,                            # 12: head-torso brightness gap (signed ok)
        coverage,                                  # 13: coverage
        upper_cov - lower_cov,                     # 14: vertical coverage balance
        left_cov - right_cov,                      # 15: horizontal coverage balance
        float((edge_norm * mask).sum() / mask_sum), # 16: edge density under mask
        *vertical_profile,                         # 17-20: vertical luminance profile
        center_x, center_y,                         # 21-22: center of mass
        float(grad_x),                              # 23: edge density
    ]

    signed_indices = {11, 12, 14, 15, 16, 23}
    centered = []
    for idx, value in enumerate(raw):
        if idx in signed_indices:
            centered.append(float(np.clip(value, -1.0, 1.0)))
        else:
            centered.append(float(np.clip((value - 0.5) * 2.0, -1.0, 1.0)))

    return [round(x, 4) for x in centered]
