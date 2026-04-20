"""Intelligence helpers for threshold recommendation and distribution analysis."""

from __future__ import annotations

import random
import statistics
from typing import Dict, List, Tuple, Any

from .similarity import cosine_similarity


def _sample_scores(embeddings: Dict[str, List[float]], max_pairs: int = 1000) -> List[float]:
    names = list(embeddings.keys())
    if len(names) < 2:
        return []

    all_pairs: List[Tuple[str, str]] = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            all_pairs.append((names[i], names[j]))

    if len(all_pairs) > max_pairs:
        random.seed(42)
        all_pairs = random.sample(all_pairs, max_pairs)

    return [cosine_similarity(embeddings[a], embeddings[b]) for a, b in all_pairs]


def analyze_distribution(embeddings: Dict[str, List[float]]) -> Dict[str, Any]:
    scores = _sample_scores(embeddings)
    if not scores:
        return {
            "histogram": [],
            "stats": {"min": 0.0, "max": 0.0, "mean": 0.0, "median": 0.0, "std": 0.0},
            "sample_pairs": 0,
        }

    min_score = min(scores)
    max_score = max(scores)
    if max_score == min_score:
        histogram = [{"start": round(min_score, 3), "end": round(max_score, 3), "count": len(scores)}]
    else:
        bucket_count = 20
        bucket_width = (max_score - min_score) / bucket_count
        counts = [0] * bucket_count
        for score in scores:
            idx = min(int((score - min_score) / bucket_width), bucket_count - 1)
            counts[idx] += 1
        histogram = [
            {
                "start": round(min_score + i * bucket_width, 3),
                "end": round(min_score + (i + 1) * bucket_width, 3),
                "count": counts[i],
            }
            for i in range(bucket_count)
        ]

    return {
        "histogram": histogram,
        "stats": {
            "min": round(min_score, 4),
            "max": round(max_score, 4),
            "mean": round(statistics.mean(scores), 4),
            "median": round(statistics.median(scores), 4),
            "std": round(statistics.pstdev(scores), 4) if len(scores) > 1 else 0.0,
        },
        "sample_pairs": len(scores),
    }


def _estimate_components(embeddings: Dict[str, List[float]], threshold: float) -> Tuple[int, int, float]:
    names = list(embeddings.keys())
    parent = {name: name for name in names}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        pa, pb = find(a), find(b)
        if pa != pb:
            parent[pb] = pa

    matches = 0
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            sim = cosine_similarity(embeddings[names[i]], embeddings[names[j]])
            if sim >= threshold:
                matches += 1
                union(names[i], names[j])

    groups: Dict[str, List[str]] = {}
    for name in names:
        root = find(name)
        groups.setdefault(root, []).append(name)

    clusters = [members for members in groups.values() if len(members) >= 2]
    avg_group_size = (sum(len(group) for group in clusters) / len(clusters)) if clusters else 0.0
    to_remove = sum(len(group) - 1 for group in clusters)
    return len(clusters), to_remove, avg_group_size


def find_optimal_threshold(
    embeddings: Dict[str, List[float]], min_groups: int = 3, max_groups: int = 50
) -> Dict[str, Any]:
    thresholds = [round(0.80 + i * 0.01, 2) for i in range(20)]
    alternatives = []
    for threshold in thresholds:
        group_count, to_remove, avg_group_size = _estimate_components(embeddings, threshold)
        alternatives.append(
            {
                "threshold": threshold,
                "group_count": group_count,
                "avg_group_size": round(avg_group_size, 2),
                "to_remove": to_remove,
            }
        )

    candidates = [
        item for item in alternatives if min_groups <= item["group_count"] <= max_groups and item["to_remove"] > 0
    ]
    recommended = candidates[0] if candidates else max(alternatives, key=lambda item: item["to_remove"])
    reason = (
        f"阈值 {recommended['threshold']} 在组数、移除数量和平均组大小之间比较平衡，"
        f"当前预估 {recommended['group_count']} 组，移除 {recommended['to_remove']} 张。"
    )
    return {
        "recommended": recommended["threshold"],
        "alternatives": alternatives,
        "reason": reason,
    }


def estimate_stats(
    threshold: float, embeddings: Dict[str, List[float]], loose_threshold: float = 0.85
) -> Dict[str, Any]:
    group_count, to_remove, _avg_group_size = _estimate_components(embeddings, threshold)
    total = len(embeddings)
    return {
        "threshold": threshold,
        "to_remove": to_remove,
        "to_keep": max(total - to_remove, 0),
        "group_count": group_count,
    }


def suggest_strategy(n_images: int, existing_groups: int = 0) -> str:
    if n_images < 100:
        return "clip"
    if n_images < 500:
        return "dual"
    return "hash_then_clip"
