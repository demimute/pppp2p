#!/usr/bin/env python3
"""Small local benchmark for analysis pipeline stages.

Usage:
  python3.11 scripts/benchmark_analysis.py /path/to/images --strategy dual --repeat 3
"""

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / 'backend'
sys.path.insert(0, str(BACKEND))

from app import _file_sizes  # type: ignore
from engine.clip_engine import compute_embeddings  # type: ignore
from engine.hash_engine import compute_hashes  # type: ignore
from engine.persona_engine import compute_persona_features  # type: ignore
from engine.similarity import find_groups_clip, find_groups_hash  # type: ignore


def is_image(path: Path) -> bool:
    return path.suffix.lower() in {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.heic', '.heif'}


def benchmark_once(folder: str, strategy: str, clip_threshold: float, phash_threshold: int, enhanced_persona: bool):
    folder_path = Path(folder)
    images = sorted([p.name for p in folder_path.iterdir() if p.is_file() and is_image(p)])
    _file_sizes[folder] = {name: (folder_path / name).stat().st_size for name in images}

    timings = {}

    started = time.perf_counter()
    embeddings = compute_embeddings(images, folder)
    timings['embed_ms'] = round((time.perf_counter() - started) * 1000, 2)

    started = time.perf_counter()
    hashes = compute_hashes(images, folder)
    timings['hash_ms'] = round((time.perf_counter() - started) * 1000, 2)

    persona_feats = {}
    if enhanced_persona:
        started = time.perf_counter()
        persona_feats = compute_persona_features(images, folder)
        timings['persona_ms'] = round((time.perf_counter() - started) * 1000, 2)

    started = time.perf_counter()
    if strategy == 'clip':
        groups = find_groups_clip(embeddings, clip_threshold, 0.85, _file_sizes[folder])
    elif strategy in {'hash', 'phash'}:
        groups = find_groups_hash(hashes, max_hamming=phash_threshold)
    else:
        from app import _build_dual_edges_parallel  # type: ignore

        pair_edges, _member_meta = _build_dual_edges_parallel(
            images,
            embeddings,
            hashes,
            persona_feats,
            enhanced_persona,
            clip_threshold,
            phash_threshold,
            1.0,
            0.92,
            0.72,
        )
        groups = [k for k, v in pair_edges.items() if v]
    timings['groups_ms'] = round((time.perf_counter() - started) * 1000, 2)
    timings['image_count'] = len(images)
    timings['group_count'] = len(groups)
    timings['total_ms'] = round(sum(v for k, v in timings.items() if k.endswith('_ms')), 2)
    return timings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder')
    parser.add_argument('--strategy', default='dual', choices=['clip', 'hash', 'phash', 'dual'])
    parser.add_argument('--clip-threshold', type=float, default=0.92)
    parser.add_argument('--phash-threshold', type=int, default=10)
    parser.add_argument('--repeat', type=int, default=3)
    parser.add_argument('--no-persona', action='store_true')
    args = parser.parse_args()

    runs = []
    for _ in range(max(1, args.repeat)):
        runs.append(benchmark_once(
            args.folder,
            args.strategy,
            args.clip_threshold,
            args.phash_threshold,
            not args.no_persona,
        ))

    summary = {}
    for key in runs[0].keys():
        values = [run[key] for run in runs]
        if isinstance(values[0], (int, float)):
            summary[key] = {
                'avg': round(statistics.mean(values), 2),
                'min': round(min(values), 2),
                'max': round(max(values), 2),
            }
        else:
            summary[key] = values[0]

    print(json.dumps({'runs': runs, 'summary': summary}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
