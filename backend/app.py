"""DedupStudio Flask Backend."""

import os
import shutil
import hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple

from flask import Flask, request, jsonify
from flask_cors import CORS

from models import (
    ScanRequest, ScanResponse,
    EmbedRequest, EmbedResponse,
    HashRequest, HashResponse,
    GroupsRequest, GroupsResponse, Group,
    MoveRequest, MoveResponse,
    UndoRequest, UndoResponse,
    HistoryResponse, HistoryEntry,
)
from cache import clear_cache

from engine.clip_engine import compute_embeddings
from engine.hash_engine import compute_hashes
from engine.similarity import find_groups_clip, find_groups_hash
from engine.persona_engine import (
    compute_persona_features,
    persona_similarity,
    compute_person_disambiguation,
    classify_person_identity,
    classify_pose_similarity,
    IDENTITY_THRESHOLD_SAME,
    IDENTITY_THRESHOLD_DIFF,
    IDENTITY_DIFF_PENALTY,
    POSE_SAME_BOOST,
)
from engine.intelligence import analyze_distribution, find_optimal_threshold, estimate_stats, suggest_strategy
from engine.scene_classifier import classify_image_scenes, classify_group_scene

app = Flask(__name__)
CORS(app)

# In-memory state
# embeddings cache: {folder: {imagename: embedding}}
_embeddings_cache: Dict[str, Dict[str, List[float]]] = {}
# hashes cache: {folder: {imagename: hash}}
_hashes_cache: Dict[str, Dict[str, str]] = {}
# persona features cache: {folder: {imagename: persona_vector}}
_persona_cache: Dict[str, Dict[str, List[float]]] = {}
# file sizes: {folder: {imagename: size}}
_file_sizes: Dict[str, Dict[str, int]] = {}
# operation history: list of HistoryEntry
_history: List[HistoryEntry] = []
_history_id_counter = 1
# undo stack: {folder: List of {src: dest} moves}
_undo_stack: Dict[str, List[Dict[str, str]]] = {}
# last operation for a folder: {folder: {images: [...], dest_folder: ...}}
_last_op: Dict[str, Dict[str, Any]] = {}
_prewarmed_folders: set[str] = set()
_prewarm_executor = ThreadPoolExecutor(max_workers=1)
_prewarm_futures: Dict[str, Any] = {}

# Supported image extensions
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.heic', '.heif'}


def _is_image(filename: str) -> bool:
    """Check if a file is a supported image."""
    ext = Path(filename).suffix.lower()
    return ext in IMAGE_EXTS


def _start_async_prewarm(folder: str, image_name: str) -> None:
    if not image_name or folder in _prewarmed_folders or folder in _prewarm_futures:
        return

    def _task():
        embeddings = compute_embeddings([image_name], folder)
        if embeddings:
            cached = _embeddings_cache.setdefault(folder, {})
            cached.update(embeddings)
        _prewarmed_folders.add(folder)
        return embeddings

    _prewarm_futures[folder] = _prewarm_executor.submit(_task)


def _consume_prewarm_if_ready(folder: str) -> None:
    future = _prewarm_futures.get(folder)
    if not future:
        return
    if not future.done():
        return
    try:
        embeddings = future.result() or {}
        if embeddings:
            cached = _embeddings_cache.setdefault(folder, {})
            cached.update(embeddings)
            _prewarmed_folders.add(folder)
    except Exception:
        pass
    finally:
        _prewarm_futures.pop(folder, None)


def _await_prewarm(folder: str) -> None:
    future = _prewarm_futures.get(folder)
    if not future:
        return
    try:
        embeddings = future.result() or {}
        if embeddings:
            cached = _embeddings_cache.setdefault(folder, {})
            cached.update(embeddings)
            _prewarmed_folders.add(folder)
    except Exception:
        pass
    finally:
        _prewarm_futures.pop(folder, None)


def _fast_persona_prefilter(a_persona: List[float], b_persona: List[float]) -> bool:
    """Cheap coarse reject before expensive pair evaluation.

    Uses a few highly discriminative persona dims to skip pairs that are
    obviously not the same subject. Returns True when the pair should be
    rejected early.
    """
    if not a_persona or not b_persona or len(a_persona) < 13 or len(b_persona) < 13:
        return False

    torso_color_gap = max(abs(a_persona[i] - b_persona[i]) for i in range(4))
    head_brightness_gap = abs(a_persona[4] - b_persona[4])
    torso_block_gap = max(abs(a_persona[i] - b_persona[i]) for i in range(7, 11))
    head_torso_gap = abs(a_persona[12] - b_persona[12])

    return (
        torso_color_gap > 0.72 or
        torso_block_gap > 0.78 or
        (head_brightness_gap > 0.62 and head_torso_gap > 0.42)
    )


def _evaluate_dual_pair(
    a: str,
    b: str,
    embeddings: Dict[str, List[float]],
    hashes: Dict[str, str],
    persona_feats: Dict[str, List[float]],
    enhanced_persona: bool,
    clip_threshold: float,
    phash_threshold: int,
    identity_penalty_strength: float,
    identity_same_threshold: float,
    identity_diff_threshold: float,
) -> Optional[Tuple[str, str, float, Dict[str, Any]]]:
    from engine.similarity import hamming_distance, cosine_similarity

    if enhanced_persona:
        a_persona = persona_feats.get(a, [])
        b_persona = persona_feats.get(b, [])
        if _fast_persona_prefilter(a_persona, b_persona):
            return None

    base_similarity = cosine_similarity(embeddings[a], embeddings[b])
    if base_similarity < clip_threshold:
        return None

    dist = hamming_distance(hashes.get(a, ""), hashes.get(b, "")) if (hashes.get(a) and hashes.get(b)) else 999
    if dist > phash_threshold:
        return None

    final_similarity = round(base_similarity, 4)
    state = 'unavailable'
    identity_score = 0.0
    pose_state = 'unavailable'
    pose_similarity = 0.0
    adjustment = 0.0
    reason = 'clip_phash_pair_pass'
    hard_rejected = False

    if enhanced_persona:
        a_persona = persona_feats.get(a, [])
        b_persona = persona_feats.get(b, [])
        if a_persona and b_persona:
            disambig = compute_person_disambiguation(
                a_persona,
                b_persona,
                base_similarity,
                identity_same_threshold=identity_same_threshold,
                identity_diff_threshold=identity_diff_threshold,
            )
            state = disambig['person_identity_state']
            identity_score = disambig['person_identity_score']
            pose_state = disambig['pose_state']
            pose_similarity = disambig['pose_similarity']
            adjustment = disambig['person_adjustment']
            reason = disambig['decision_reason']

            if state == 'different':
                hard_rejected = True
                reason = 'different_person_hard_reject'
            elif state == 'uncertain':
                adjustment = round(-0.12 * identity_penalty_strength, 4)
                reason = 'person_identity_uncertain_penalty'
            elif adjustment < 0:
                adjustment = round(adjustment * (0.5 + identity_penalty_strength), 4)

            final_similarity = round(max(0.0, min(1.0, base_similarity + adjustment)), 4)
            if hard_rejected or final_similarity < clip_threshold:
                return None

    shared_meta = {
        'hamming_distance': dist,
        'person_identity_state': state,
        'person_identity_score': identity_score,
        'pose_state': pose_state,
        'pose_similarity': pose_similarity,
        'person_adjustment': adjustment,
        'decision_reason': reason,
        'hard_rejected_by_identity': hard_rejected,
    }
    return a, b, final_similarity, shared_meta


def _build_dual_edges_parallel(
    image_names: List[str],
    embeddings: Dict[str, List[float]],
    hashes: Dict[str, str],
    persona_feats: Dict[str, List[float]],
    enhanced_persona: bool,
    clip_threshold: float,
    phash_threshold: int,
    identity_penalty_strength: float,
    identity_same_threshold: float,
    identity_diff_threshold: float,
) -> Tuple[Dict[str, Dict[str, float]], Dict[str, Dict[str, Dict[str, Any]]]]:
    from collections import defaultdict

    pair_edges = defaultdict(dict)
    member_meta = defaultdict(dict)
    if len(image_names) < 2:
        return pair_edges, member_meta

    max_workers = min(8, max(1, (os.cpu_count() or 4)))
    chunk_size = max(1, min(32, len(image_names) // max_workers or 1))

    def process_chunk(start_index: int, end_index: int):
        chunk_results = []
        for i in range(start_index, end_index):
            a = image_names[i]
            for j in range(i + 1, len(image_names)):
                b = image_names[j]
                result = _evaluate_dual_pair(
                    a,
                    b,
                    embeddings,
                    hashes,
                    persona_feats,
                    enhanced_persona,
                    clip_threshold,
                    phash_threshold,
                    identity_penalty_strength,
                    identity_same_threshold,
                    identity_diff_threshold,
                )
                if result is not None:
                    chunk_results.append(result)
        return chunk_results

    ranges = [(start, min(start + chunk_size, len(image_names) - 1)) for start in range(0, len(image_names) - 1, chunk_size)]
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for chunk_results in executor.map(lambda r: process_chunk(r[0], r[1]), ranges):
            for a, b, final_similarity, shared_meta in chunk_results:
                pair_edges[a][b] = final_similarity
                pair_edges[b][a] = final_similarity
                member_meta[a][b] = shared_meta
                member_meta[b][a] = shared_meta

    return pair_edges, member_meta


@app.route("/api/scan", methods=["POST"])
def scan():
    """Scan folder for images."""
    try:
        data = request.get_json()
        folder = data.get("folder", "").strip()

        if not folder:
            return jsonify({"error": "folder is required"}), 400

        folder_path = Path(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            return jsonify({"error": f"folder does not exist: {folder}"}), 400

        # If the dedup folder has been removed externally, treat this folder as a fresh session.
        # This prevents stale undo/history state from surviving across test fixture resets.
        dest_folder = folder_path.parent / f"{folder_path.name}-已去重"
        if not dest_folder.exists():
            _undo_stack.pop(folder, None)
            _last_op.pop(folder, None)
            global _history
            _history = [entry for entry in _history if entry.folder != folder]

        # Scan images
        all_images = []
        for entry in sorted(folder_path.iterdir()):
            if entry.is_file() and _is_image(entry.name):
                all_images.append(entry.name)

        # Get cached status
        from cache import get_cache
        cached_count = 0
        images_info = []
        sizes = {}

        for img_name in all_images:
            size = (folder_path / img_name).stat().st_size
            sizes[img_name] = size
            cached = get_cache(folder, img_name) is not None
            if cached:
                cached_count += 1
            images_info.append({
                "name": img_name,
                "size": size,
                "cached": cached,
            })

        # Store sizes globally
        _file_sizes[folder] = sizes

        if all_images:
            _consume_prewarm_if_ready(folder)
            _start_async_prewarm(folder, all_images[0])

        response = {
            "folder": folder,
            "total": len(all_images),
            "cached": cached_count,
            "images": images_info,
        }
        return jsonify(response)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/embed", methods=["POST"])
def embed():
    """Compute CLIP embeddings for images."""
    try:
        data = request.get_json()
        folder = data.get("folder", "").strip()
        images = data.get("images", [])

        if not folder:
            return jsonify({"error": "folder is required"}), 400
        if not images:
            return jsonify({"error": "images list is required"}), 400

        _await_prewarm(folder)

        cached_embeddings = _embeddings_cache.get(folder, {})
        missing_images = [name for name in images if name not in cached_embeddings]

        # Compute embeddings
        embeddings = dict(cached_embeddings)
        if missing_images:
            embeddings.update(compute_embeddings(missing_images, folder))

        # Cache in memory
        if folder not in _embeddings_cache:
            _embeddings_cache[folder] = {}
        _embeddings_cache[folder].update(embeddings)

        return jsonify({"embeddings": embeddings})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/hash", methods=["POST"])
def hash_images():
    """Compute perceptual hashes for images."""
    try:
        data = request.get_json()
        folder = data.get("folder", "").strip()
        images = data.get("images", [])

        if not folder:
            return jsonify({"error": "folder is required"}), 400
        if not images:
            return jsonify({"error": "images list is required"}), 400

        # Compute hashes
        hashes = compute_hashes(images, folder)

        # Cache in memory
        if folder not in _hashes_cache:
            _hashes_cache[folder] = {}
        _hashes_cache[folder].update(hashes)

        return jsonify({"hashes": hashes})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/groups", methods=["POST"])
def groups():
    """Compute similarity groups."""
    try:
        data = request.get_json()
        folder = data.get("folder", "").strip()
        strategy = data.get("strategy", "clip")
        threshold = float(data.get("threshold", 0.93))
        loose_threshold = float(data.get("loose_threshold", 0.85))
        clip_threshold = float(data.get("clip_threshold", threshold or 0.92))
        phash_threshold = int(data.get("phash_threshold", 10))
        # Person disambiguation stays enabled by default for dual.
        enhanced_persona = data.get("enhanced_persona", True) if strategy == "dual" else False
        identity_penalty_strength = float(data.get("identity_penalty_strength", 0.5))
        identity_same_threshold = float(data.get("identity_same_threshold", IDENTITY_THRESHOLD_SAME))
        identity_diff_threshold = float(data.get("identity_diff_threshold", IDENTITY_THRESHOLD_DIFF))
        identity_version = str(data.get("identity_version", "v1")).strip() or "v1"

        if not folder:
            return jsonify({"error": "folder is required"}), 400

        # Get file sizes for winner determination
        sizes = _file_sizes.get(folder, {})
        if not sizes:
            folder_path = Path(folder)
            if not folder_path.exists() or not folder_path.is_dir():
                return jsonify({"error": f"folder does not exist: {folder}"}), 400
            sizes = {
                entry.name: entry.stat().st_size
                for entry in sorted(folder_path.iterdir())
                if entry.is_file() and _is_image(entry.name)
            }
            _file_sizes[folder] = sizes

        embeddings = {}
        hashes = {}
        image_scenes = classify_image_scenes(list(sizes.keys()), folder)

        if strategy == "clip":
            _await_prewarm(folder)
            images = list(sizes.keys())
            embeddings = dict(_embeddings_cache.get(folder, {}))
            missing_images = [name for name in images if name not in embeddings]
            if missing_images:
                embeddings.update(compute_embeddings(missing_images, folder))
                _embeddings_cache[folder] = embeddings
            group_list = find_groups_clip(embeddings, threshold, loose_threshold, sizes)

        elif strategy in {"hash", "phash"}:
            hashes = _hashes_cache.get(folder, {})
            if not hashes:
                images = list(sizes.keys())
                hashes = compute_hashes(images, folder)
                _hashes_cache[folder] = hashes
            group_list = find_groups_hash(hashes, max_hamming=int(threshold))

        elif strategy in {"size", "filesize"}:
            # Group by exact file size
            from collections import defaultdict
            size_groups = defaultdict(list)
            folder_path = Path(folder)
            for img_name in sizes:
                size = sizes[img_name]
                size_groups[size].append(img_name)

            group_list = []
            group_id = 1
            for size, members in size_groups.items():
                if len(members) < 2:
                    continue
                winner = members[0]
                from models import GroupMember
                group_members = []
                for m in members:
                    sim = 1.0 if m == winner else 0.99  # Approximate
                    group_members.append(GroupMember(
                        name=m,
                        similarity=sim,
                        to_remove=(m != winner),
                    ))
                group_list.append(Group(
                    id=group_id,
                    winner=winner,
                    winner_size=size,
                    members=group_members,
                ))
                group_id += 1

        elif strategy in {"both", "dual"}:
            # Dual now groups by accepted pair edges first, then selects a default optimal item.
            _await_prewarm(folder)
            embeddings = dict(_embeddings_cache.get(folder, {}))
            hashes = _hashes_cache.get(folder, {})
            persona_feats = _persona_cache.get(folder, {}) if enhanced_persona else {}
            images = list(sizes.keys())
            missing_embeddings = [name for name in images if name not in embeddings]
            if missing_embeddings:
                embeddings.update(compute_embeddings(missing_embeddings, folder))
                _embeddings_cache[folder] = embeddings
            if not hashes:
                hashes = compute_hashes(images, folder)
                _hashes_cache[folder] = hashes
            if enhanced_persona and not persona_feats:
                persona_feats = compute_persona_features(images, folder)
                _persona_cache[folder] = persona_feats

            from models import GroupMember, Group

            image_names = sorted(images)
            pair_edges, member_meta = _build_dual_edges_parallel(
                image_names,
                embeddings,
                hashes,
                persona_feats,
                enhanced_persona,
                clip_threshold,
                phash_threshold,
                identity_penalty_strength,
                identity_same_threshold,
                identity_diff_threshold,
            )

            visited = set()
            components = []
            for name in image_names:
                if name in visited or not pair_edges.get(name):
                    continue
                queue = [name]
                visited.add(name)
                component = []
                while queue:
                    node = queue.pop(0)
                    component.append(node)
                    for neighbor in pair_edges[node].keys():
                        if neighbor not in visited:
                            visited.add(neighbor)
                            queue.append(neighbor)
                if len(component) >= 2:
                    components.append(sorted(component))

            group_list = []
            group_id = 1
            for component in components:
                def optimal_key(name: str):
                    neighbors = pair_edges[name]
                    degree = sum(1 for other in component if other in neighbors)
                    score_sum = sum(neighbors.get(other, 0.0) for other in component if other != name)
                    return (degree, round(score_sum, 6), sizes.get(name, 0), name)

                optimal_name = max(component, key=optimal_key)
                members = []
                for name in component:
                    pair_info = member_meta[optimal_name].get(name, {}) if name != optimal_name else {}
                    displayed_similarity = 1.0 if name == optimal_name else pair_edges[optimal_name].get(name, max(pair_edges[name].values(), default=0.0))
                    scene_meta = image_scenes.get(name, {})
                    members.append(GroupMember(
                        name=name,
                        similarity=round(displayed_similarity, 4),
                        to_remove=(name != optimal_name),
                        hamming_distance=pair_info.get('hamming_distance', 0),
                        person_identity_state=pair_info.get('person_identity_state', 'unavailable'),
                        person_identity_score=pair_info.get('person_identity_score', 0.0),
                        pose_state=pair_info.get('pose_state', 'unavailable'),
                        pose_similarity=pair_info.get('pose_similarity', 0.0),
                        person_adjustment=pair_info.get('person_adjustment', 0.0),
                        decision_reason=pair_info.get('decision_reason', 'pair_component_member'),
                        scene_type=scene_meta.get('scene_type', 'unknown'),
                        scene_confidence=scene_meta.get('scene_confidence', 0.0),
                        scene_signals=scene_meta.get('scene_signals', []),
                    ))

                total_identity = sum(getattr(m, 'person_identity_score', 0.0) for m in members if m.name != optimal_name)
                group_scene = classify_group_scene([m.name for m in members], image_scenes)
                group_list.append(Group(
                    id=group_id,
                    winner=optimal_name,
                    winner_size=sizes.get(optimal_name, 0),
                    members=members,
                    persona_enabled=enhanced_persona,
                    identity_version=identity_version,
                    persona_boost=round(total_identity / max(len(members) - 1, 1), 4),
                    group_final_score=round(sum(m.similarity for m in members) / len(members), 4),
                    group_decision_reason='pairwise_monotonic_component',
                    group_scene_type=group_scene.get('group_scene_type', 'unknown'),
                    group_scene_confidence=group_scene.get('group_scene_confidence', 0.0),
                    group_scene_signals=group_scene.get('group_scene_signals', []),
                ))
                group_id += 1

        else:
            return jsonify({"error": f"unknown strategy: {strategy}"}), 400

        # Fill in winner_size from actual file sizes and attach display-only scene tags.
        for g in group_list:
            g.winner_size = sizes.get(g.winner, 0)
            for m in g.members:
                scene_meta = image_scenes.get(m.name, {})
                m.scene_type = scene_meta.get('scene_type', 'unknown')
                m.scene_confidence = scene_meta.get('scene_confidence', 0.0)
                m.scene_signals = scene_meta.get('scene_signals', [])
            group_scene = classify_group_scene([m.name for m in g.members], image_scenes)
            g.group_scene_type = group_scene.get('group_scene_type', 'unknown')
            g.group_scene_confidence = group_scene.get('group_scene_confidence', 0.0)
            g.group_scene_signals = group_scene.get('group_scene_signals', [])

        # Calculate stats
        total_groups = len(group_list)
        to_remove = sum(1 for g in group_list for m in g.members if m.to_remove)
        to_keep = max(len(sizes) - to_remove, 0)

        intelligence = None
        if strategy == "clip" and embeddings:
            distribution = analyze_distribution(embeddings)
            recommendation = find_optimal_threshold(embeddings)
            intelligence = {
                "distribution": distribution,
                "recommended_threshold": recommendation["recommended"],
                "alternatives": recommendation["alternatives"],
                "reason": recommendation["reason"],
                "suggested_strategy": suggest_strategy(len(sizes), total_groups),
            }

        return jsonify({
            "groups": [
                {
                    "id": g.id,
                    "winner": g.winner,
                    "winner_size": g.winner_size,
                    "persona_enabled": g.persona_enabled,
                    "persona_boost": g.persona_boost,
                    "identity_version": getattr(g, 'identity_version', 'v1'),
                    "group_final_score": getattr(g, 'group_final_score', 0.0),
                    "group_decision_reason": getattr(g, 'group_decision_reason', ''),
                    "group_scene_type": getattr(g, 'group_scene_type', 'unknown'),
                    "group_scene_confidence": getattr(g, 'group_scene_confidence', 0.0),
                    "group_scene_signals": getattr(g, 'group_scene_signals', []),
                    "members": [
                        {
                            "name": m.name,
                            "similarity": m.similarity,
                            "to_remove": m.to_remove,
                            "size": sizes.get(m.name, 0),
                            "path": str(Path(folder) / m.name),
                            "hamming_distance": m.hamming_distance,
                            "persona_similarity": m.persona_similarity,
                            "persona_vector": m.persona_vector if m.persona_vector else [],
                            "person_identity_state": getattr(m, 'person_identity_state', 'unavailable'),
                            "person_identity_score": getattr(m, 'person_identity_score', 0.0),
                            "pose_state": getattr(m, 'pose_state', 'unavailable'),
                            "pose_similarity": getattr(m, 'pose_similarity', 0.0),
                            "person_adjustment": getattr(m, 'person_adjustment', 0.0),
                            "decision_reason": getattr(m, 'decision_reason', ''),
                            "hard_rejected_by_identity": getattr(m, 'hard_rejected_by_identity', False),
                            "scene_type": getattr(m, 'scene_type', 'unknown'),
                            "scene_confidence": getattr(m, 'scene_confidence', 0.0),
                            "scene_signals": getattr(m, 'scene_signals', []),
                        }
                        for m in g.members
                    ],
                }
                for g in group_list
            ],
            "stats": {
                "total_groups": total_groups,
                "to_remove": to_remove,
                "to_keep": to_keep,
            },
            "intelligence": intelligence,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/move", methods=["POST"])
def move():
    """Move files to deduplication folder."""
    try:
        data = request.get_json()
        folder = data.get("folder", "").strip()
        moves = data.get("moves", [])
        strategy = data.get("strategy", "unknown")
        threshold = float(data.get("threshold", 0.0) or 0.0)

        if not folder:
            return jsonify({"error": "folder is required"}), 400
        if not moves:
            return jsonify({"success": True, "moved": 0}), 200

        folder_path = Path(folder)
        dest_folder = folder_path.parent / f"{folder_path.name}-已去重"
        dest_folder.mkdir(exist_ok=True)

        moved_files = []
        move_records = []

        for move_item in moves:
            name = move_item.get("name", "")
            action = move_item.get("action", "")
            if action != "remove":
                continue
            src = folder_path / name
            if not src.exists():
                continue
            dest = dest_folder / name
            # Handle name conflict
            if dest.exists():
                base = dest.stem
                ext = dest.suffix
                counter = 1
                while dest.exists():
                    dest = dest_folder / f"{base}_{counter}{ext}"
                    counter += 1
            shutil.move(str(src), str(dest))
            moved_files.append(name)
            move_records.append({"src": str(src), "dest": str(dest)})

        # Record for undo
        if folder not in _undo_stack:
            _undo_stack[folder] = []
        _undo_stack[folder].append(move_records)
        _last_op[folder] = {
            "images": moved_files,
            "dest_folder": str(dest_folder),
        }

        # Add to history
        global _history_id_counter, _history
        _history.append(HistoryEntry(
            id=_history_id_counter,
            time=datetime.now().isoformat(),
            strategy=strategy,
            threshold=threshold,
            removed=len(moved_files),
            folder=folder,
            moved_files=moved_files,
        ))
        _history_id_counter += 1

        return jsonify({"success": True, "moved": len(moved_files)})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/undo", methods=["POST"])
def undo():
    """Undo the last move operation."""
    try:
        data = request.get_json()
        folder = data.get("folder", "").strip()

        if not folder:
            return jsonify({"error": "folder is required"}), 400

        if folder not in _undo_stack or not _undo_stack[folder]:
            return jsonify({"success": False, "error": "nothing to undo"}), 400

        last_moves = _undo_stack[folder].pop()
        restored = 0

        for move_record in last_moves:
            src = move_record["src"]
            dest = move_record["dest"]
            if Path(dest).exists():
                shutil.move(dest, src)
                restored += 1

        # Update history: mark the most recent entry for this folder as undone
        for entry in reversed(_history):
            if entry.folder == folder and not entry.undone:
                entry.undone = True
                break

        if folder in _last_op:
            del _last_op[folder]

        return jsonify({"success": True, "restored": restored})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/analyze", methods=["POST"])
def analyze():
    """Analyze embedding distribution and recommend threshold."""
    try:
        data = request.get_json() or {}
        folder = data.get("folder", "").strip()
        strategy = data.get("strategy", "clip")
        if not folder:
            return jsonify({"error": "folder is required"}), 400

        sizes = _file_sizes.get(folder, {})
        if not sizes:
            folder_path = Path(folder)
            if folder_path.exists() and folder_path.is_dir():
                sizes = {
                    entry.name: entry.stat().st_size
                    for entry in sorted(folder_path.iterdir())
                    if entry.is_file() and _is_image(entry.name)
                }
                _file_sizes[folder] = sizes

        images = list(sizes.keys())
        embeddings = _embeddings_cache.get(folder, {})
        if strategy in {"clip", "dual", "phash"} and not embeddings:
            embeddings = compute_embeddings(images, folder)
            _embeddings_cache[folder] = embeddings

        distribution = analyze_distribution(embeddings)
        recommendation = find_optimal_threshold(embeddings)
        return jsonify({
            "distribution": distribution,
            "recommended_threshold": recommendation["recommended"],
            "alternatives": recommendation["alternatives"],
            "reason": recommendation["reason"],
            "n_images": len(images),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/history", methods=["GET"])
def history():
    """Get operation history."""
    try:
        return jsonify({
            "history": [
                {
                    "id": h.id,
                    "time": h.time,
                    "strategy": h.strategy,
                    "threshold": h.threshold,
                    "removed": h.removed,
                    "folder": h.folder,
                    "undone": h.undone,
                }
                for h in reversed(_history)
            ]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/clear_cache", methods=["POST"])
def api_clear_cache():
    """Clear cache for a folder or all."""
    try:
        data = request.get_json() or {}
        folder = data.get("folder")
        count = clear_cache(folder)
        return jsonify({"success": True, "cleared": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("DEDUP_BACKEND_PORT", "5000"))
    debug_enabled = os.environ.get("DEDUP_BACKEND_DEBUG", "0") == "1"
    app.run(
        host="127.0.0.1",
        port=port,
        debug=debug_enabled,
        use_reloader=debug_enabled,
    )
