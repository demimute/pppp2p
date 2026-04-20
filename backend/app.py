"""DedupStudio Flask Backend."""

import os
import shutil
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional

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

# Supported image extensions
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.heic', '.heif'}


def _is_image(filename: str) -> bool:
    """Check if a file is a supported image."""
    ext = Path(filename).suffix.lower()
    return ext in IMAGE_EXTS


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

        # Compute embeddings
        embeddings = compute_embeddings(images, folder)

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

        if strategy == "clip":
            embeddings = _embeddings_cache.get(folder, {})
            if not embeddings:
                images = list(sizes.keys())
                embeddings = compute_embeddings(images, folder)
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
            # CLIP + pHash double保险, both thresholds must match.
            # When enhanced_persona=True: also compute persona features and use them
            # as a third signal (subject identity) in group formation and filtering.
            embeddings = _embeddings_cache.get(folder, {})
            hashes = _hashes_cache.get(folder, {})
            persona_feats = _persona_cache.get(folder, {}) if enhanced_persona else {}
            images = list(sizes.keys())
            if not embeddings:
                embeddings = compute_embeddings(images, folder)
                _embeddings_cache[folder] = embeddings
            if not hashes:
                hashes = compute_hashes(images, folder)
                _hashes_cache[folder] = hashes
            if enhanced_persona and not persona_feats:
                persona_feats = compute_persona_features(images, folder)
                _persona_cache[folder] = persona_feats

            # Keep the loose graph threshold at least as strict as the direct threshold.
            # If loose_threshold drops below clip_threshold, large weakly-connected components
            # can collapse into a single winner-centered group and paradoxically reduce results.
            clip_groups = find_groups_clip(
                embeddings,
                threshold=clip_threshold,
                loose_threshold=max(loose_threshold, clip_threshold),
                file_sizes=sizes,
            )

            filtered_groups = []
            from engine.similarity import hamming_distance
            for g in clip_groups:
                winner_hash = hashes.get(g.winner, "")
                winner_persona = persona_feats.get(g.winner, []) if enhanced_persona else []
                new_members = []

                for m in g.members:
                    h = hashes.get(m.name, "")
                    dist = hamming_distance(winner_hash, h) if (h and winner_hash) else 999

                    if dist > phash_threshold:
                        continue

                    m.hamming_distance = dist
                    m.hard_rejected_by_identity = False

                    # Phase 1 Person Disambiguation (replaces old persona fusion)
                    if enhanced_persona and winner_persona:
                        member_persona = persona_feats.get(m.name, [])
                        if member_persona:
                            disambig = compute_person_disambiguation(
                                winner_persona,
                                member_persona,
                                m.similarity,
                                identity_same_threshold=identity_same_threshold,
                                identity_diff_threshold=identity_diff_threshold,
                            )
                            m.person_identity_state = disambig["person_identity_state"]
                            m.person_identity_score = disambig["person_identity_score"]
                            m.pose_state = disambig["pose_state"]
                            m.pose_similarity = disambig["pose_similarity"]
                            scaled_adjustment = disambig["person_adjustment"]
                            if m.person_identity_state == "uncertain":
                                scaled_adjustment = round(-0.12 * identity_penalty_strength, 4)
                                m.decision_reason = "person_identity_uncertain_penalty"
                            elif scaled_adjustment < 0:
                                scaled_adjustment = round(
                                    scaled_adjustment * (0.5 + identity_penalty_strength),
                                    4,
                                )
                            m.person_adjustment = scaled_adjustment
                            m.decision_reason = disambig["decision_reason"]
                            m.persona_vector = member_persona

                            if m.person_identity_state == "different":
                                m.hard_rejected_by_identity = True
                                m.decision_reason = "different_person_hard_reject"
                                continue

                            # Apply adjustment to base similarity (clip to [0, 1]).
                            # Dual strategy should gate final membership on the adjusted score,
                            # otherwise identity penalties only change display text and never
                            # affect actual grouping results.
                            adjusted = max(0.0, min(1.0, m.similarity + scaled_adjustment))
                            m.similarity = round(adjusted, 4)
                            if adjusted < clip_threshold:
                                continue

                    new_members.append(m)

                if len(new_members) >= 2:
                    g.members = new_members
                    g.persona_enabled = enhanced_persona
                    g.identity_version = identity_version
                    g.identity_same_threshold = identity_same_threshold
                    g.identity_diff_threshold = identity_diff_threshold
                    total_identity = sum(getattr(m, 'person_identity_score', 0.0) for m in new_members)
                    g.persona_boost = round(total_identity / len(new_members), 4) if new_members else 0.0
                    reasons = [getattr(m, 'decision_reason', '') for m in new_members if hasattr(m, 'decision_reason')]
                    g.group_decision_reason = reasons[0] if reasons else ""
                    g.group_final_score = round(sum(m.similarity for m in new_members) / len(new_members), 4)
                    filtered_groups.append(g)
            group_list = filtered_groups

        else:
            return jsonify({"error": f"unknown strategy: {strategy}"}), 400

        # Fill in winner_size from actual file sizes
        for g in group_list:
            g.winner_size = sizes.get(g.winner, 0)

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
