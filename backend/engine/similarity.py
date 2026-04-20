"""Similarity computation and grouping for DedupStudio."""

import sys
from pathlib import Path

_backend_root = Path(__file__).parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

import math
import os
from typing import List, Dict
from collections import defaultdict
from models import Group, GroupMember


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Compute cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def hamming_distance(a: str, b: str) -> int:
    """Compute Hamming distance between two hex hash strings."""
    if len(a) != len(b):
        max_len = max(len(a), len(b))
        a = a.zfill(max_len)
        b = b.zfill(max_len)
    return sum(c1 != c2 for c1, c2 in zip(a, b))


def find_groups_clip(
    embeddings: Dict[str, List[float]],
    threshold: float,
    loose_threshold: float = 0.85,
    file_sizes: Dict[str, int] | None = None,
) -> List[Group]:
    """Find similarity groups using CLIP embeddings.

    The algorithm intentionally avoids strict transitive grouping.
    It first finds loose connected components, then picks a winner in each
    component and keeps only members whose *direct* similarity with that
    winner meets the threshold.
    """
    if len(embeddings) < 2:
        return []

    names = list(embeddings.keys())
    n = len(names)
    file_sizes = file_sizes or {}

    adj = defaultdict(set)
    for i in range(n):
        for j in range(i + 1, n):
            sim = cosine_similarity(embeddings[names[i]], embeddings[names[j]])
            if sim >= loose_threshold:
                adj[i].add(j)
                adj[j].add(i)

    visited = [False] * n
    components: List[List[int]] = []
    for start in range(n):
        if visited[start]:
            continue
        component = []
        queue = [start]
        visited[start] = True
        while queue:
            node = queue.pop(0)
            component.append(node)
            for neighbor in adj[node]:
                if not visited[neighbor]:
                    visited[neighbor] = True
                    queue.append(neighbor)
        components.append(component)

    groups: List[Group] = []
    group_id = 1
    for component in components:
        if len(component) < 2:
            continue

        def direct_member_count(candidate_idx: int) -> int:
            candidate_name = names[candidate_idx]
            count = 1
            for other_idx in component:
                if other_idx == candidate_idx:
                    continue
                sim = cosine_similarity(embeddings[candidate_name], embeddings[names[other_idx]])
                if sim >= threshold:
                    count += 1
            return count

        winner_idx = max(
            component,
            key=lambda idx: (
                direct_member_count(idx),
                file_sizes.get(names[idx], 0),
                names[idx],
            ),
        )
        winner_name = names[winner_idx]

        direct_members = [
            GroupMember(name=winner_name, similarity=1.0, to_remove=False)
        ]
        for idx in component:
            if idx == winner_idx:
                continue
            sim_to_winner = cosine_similarity(embeddings[winner_name], embeddings[names[idx]])
            if sim_to_winner >= threshold:
                direct_members.append(
                    GroupMember(
                        name=names[idx],
                        similarity=round(sim_to_winner, 3),
                        to_remove=True,
                    )
                )

        if len(direct_members) < 2:
            continue

        direct_members.sort(key=lambda m: (m.to_remove, -m.similarity, m.name))
        groups.append(
            Group(
                id=group_id,
                winner=winner_name,
                winner_size=file_sizes.get(winner_name, 0),
                members=direct_members,
            )
        )
        group_id += 1

    return groups


def find_groups_hash(
    hashes: Dict[str, str],
    max_hamming: int = 10,
) -> List[Group]:
    """Find similarity groups using perceptual hashes.

    Args:
        hashes: Dict mapping image name -> hex hash string.
        max_hamming: Max Hamming distance to consider as duplicate (default 10).

    Returns:
        List of Group objects.
    """
    if len(hashes) < 2:
        return []

    names = list(hashes.keys())
    n = len(names)

    # Build adjacency by Hamming distance
    adj = defaultdict(set)
    for i in range(n):
        for j in range(i + 1, n):
            dist = hamming_distance(hashes[names[i]], hashes[names[j]])
            if dist <= max_hamming:
                adj[i].add(j)
                adj[j].add(i)

    # Find connected components
    visited = [False] * n
    components: List[List[int]] = []

    for start in range(n):
        if visited[start]:
            continue
        component = []
        queue = [start]
        visited[start] = True
        while queue:
            node = queue.pop(0)
            component.append(node)
            for neighbor in adj[node]:
                if not visited[neighbor]:
                    visited[neighbor] = True
                    queue.append(neighbor)
        components.append(component)

    groups: List[Group] = []
    group_id = 1

    for component in components:
        if len(component) < 2:
            continue

        winner_idx = component[0]
        group_members = []
        for idx in component:
            dist = hamming_distance(hashes[names[winner_idx]], hashes[names[idx]])
            max_dist = max(len(hashes[names[winner_idx]]), len(hashes[names[idx]])) * 4
            similarity = max(0.0, 1.0 - (dist / max_dist))
            group_members.append(GroupMember(
                name=names[idx],
                similarity=round(similarity, 3),
                to_remove=(idx != winner_idx),
                hamming_distance=dist,
            ))

        groups.append(Group(
            id=group_id,
            winner=names[winner_idx],
            winner_size=0,
            members=group_members,
        ))
        group_id += 1

    return groups
