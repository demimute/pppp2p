# identity_v2 baseline fixtures

This directory holds reproducible hard-case fixtures for local identity experiments.

## Purpose

These fixtures pin the current failure mode for lightweight identity heuristics:
images with nearly identical template/layout that should still be treated as different people.

## Canonical cases

- `same_a.png` / `same_a_copy.png`: exact same-person duplicate, should remain `same`
- `same_pose_diff_person.png` / `same_a.png`: same pose/template, should be `different`
- `same_pose_diff_person.png` / `diff_green.png`: hard different-person case, should be `different`
- `same_pose_diff_person.png` / `diff_blue.png`: current hardest case, still incorrectly `same` under v1

## Rebuild

Use `python3.11 tests/fixtures/build_identity_v2_baseline.py` to regenerate the fixture folder under `/tmp/dedup-real-handtest-v1` for local API replays.
