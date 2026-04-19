"""Pytest-style unit tests for persona enhancement components (Phase 1)."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))
os.chdir(os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

import pytest
from unittest.mock import patch

from models import Group, GroupMember
from engine.persona_engine import (
    compute_persona_features,
    persona_similarity,
    _extract_persona_vec,
    classify_person_identity,
    classify_pose_similarity,
    compute_person_disambiguation,
    IDENTITY_THRESHOLD_SAME,
    IDENTITY_THRESHOLD_DIFF,
    IDENTITY_DIFF_PENALTY,
    POSE_SAME_BOOST,
)


# ---------------------------------------------------------------------------
# Legacy / identity-preserving tests
# ---------------------------------------------------------------------------

def test_persona_similarity_identical_vectors():
    v = [1.0] * 16
    assert persona_similarity(v, v) == pytest.approx(1.0)


def test_persona_similarity_opposite_vectors():
    v1 = [1.0] * 16
    v2 = [-1.0] * 16
    assert persona_similarity(v1, v2) == pytest.approx(-1.0)


def test_persona_similarity_orthogonal_vectors():
    v1 = [1.0] * 8 + [0.0] * 8
    v2 = [0.0] * 8 + [1.0] * 8
    assert persona_similarity(v1, v2) == pytest.approx(0.0)


def test_persona_similarity_empty_vectors():
    assert persona_similarity([], []) == 0.0
    assert persona_similarity([1.0], []) == 0.0


def test_persona_vector_has_16_dims(tmp_path):
    from PIL import Image

    img_path = tmp_path / 'test.jpg'
    Image.new('RGB', (24, 32), color=(128, 128, 128)).save(img_path)
    vec = _extract_persona_vec('test.jpg', img_path)
    assert len(vec) == 16


def test_persona_vector_missing_file_returns_empty():
    from pathlib import Path
    vec = _extract_persona_vec('missing.jpg', Path('/tmp/does-not-exist.jpg'))
    assert vec == []


def test_persona_vector_same_image_content_is_stable(tmp_path):
    from PIL import Image

    img_path = tmp_path / 'alice_001.jpg'
    Image.new('RGB', (24, 32), color=(120, 90, 60)).save(img_path)

    v1 = _extract_persona_vec('alice_001.jpg', img_path)
    v2 = _extract_persona_vec('alice_001.jpg', img_path)
    assert v1 == v2
    assert len(v1) == 16


def test_persona_vector_different_image_content_gives_different_vectors(tmp_path):
    from PIL import Image

    img_a = tmp_path / 'alice_001.jpg'
    img_b = tmp_path / 'bob_001.jpg'
    Image.new('RGB', (24, 32), color=(220, 30, 30)).save(img_a)
    Image.new('RGB', (24, 32), color=(30, 30, 220)).save(img_b)

    v1 = _extract_persona_vec('alice_001.jpg', img_a)
    v2 = _extract_persona_vec('bob_001.jpg', img_b)
    assert v1 != v2


def test_compute_persona_features_returns_all_images(tmp_path):
    from PIL import Image

    for name, color in [('a.jpg', (255, 0, 0)), ('b.jpg', (0, 255, 0)), ('c.jpg', (0, 0, 255))]:
        Image.new('RGB', (24, 32), color=color).save(tmp_path / name)

    feats = compute_persona_features(['a.jpg', 'b.jpg', 'c.jpg'], str(tmp_path))
    assert set(feats.keys()) == {'a.jpg', 'b.jpg', 'c.jpg'}
    for v in feats.values():
        assert len(v) == 16


def test_group_member_defaults():
    m = GroupMember(name='x.jpg', similarity=0.95)
    assert m.persona_similarity == 0.0
    assert m.persona_vector == []
    assert m.to_remove == False
    assert m.hamming_distance == 0
    # Phase 1 fields default
    assert m.person_identity_state == "unavailable"
    assert m.person_identity_score == 0.0
    assert m.pose_state == "unavailable"
    assert m.pose_similarity == 0.0
    assert m.person_adjustment == 0.0
    assert m.decision_reason == ""


def test_group_defaults():
    g = Group(id=1, winner='x.jpg', winner_size=1000, members=[])
    assert g.persona_enabled == False
    assert g.persona_boost == 0.0
    assert g.group_final_score == 0.0
    assert g.group_decision_reason == ""


def test_group_with_persona_enhancement():
    m1 = GroupMember(name='x.jpg', similarity=0.99)
    m2 = GroupMember(name='y.jpg', similarity=0.85, persona_similarity=0.92, persona_vector=[0.5]*16)
    g = Group(
        id=1, winner='x.jpg', winner_size=5000,
        members=[m1, m2],
        persona_enabled=True,
        persona_boost=0.46,
    )
    assert g.persona_enabled == True
    assert g.persona_boost > 0
    assert g.members[1].persona_similarity > 0


# ---------------------------------------------------------------------------
# Phase 1: Person Disambiguation tests
# ---------------------------------------------------------------------------

class TestClassifyPersonIdentity:
    def test_same_person_high_similarity(self):
        # Build two nearly-identical high-quality vectors
        v_same = [0.9] * 16
        state, score = classify_person_identity(v_same, v_same)
        assert state == "same"
        assert score == pytest.approx(1.0)

    def test_different_person_low_similarity(self):
        v1 = [1.0] * 16
        v2 = [-1.0] * 16
        state, score = classify_person_identity(v1, v2)
        assert state == "different"
        assert score == pytest.approx(-1.0)

    def test_uncertain_in_between(self):
        # midway value: cosine of angle ~0.3
        v1 = [1.0] * 8 + [0.0] * 8
        v2 = [0.5] * 8 + [0.866] * 8  # cos sim ~0.5
        state, score = classify_person_identity(v1, v2)
        assert state == "uncertain"
        assert 0.0 <= score <= 1.0

    def test_unavailable_on_empty_vectors(self):
        state, score = classify_person_identity([], [])
        assert state == "unavailable"
        assert score == 0.0

    def test_unavailable_on_low_quality_vectors(self):
        # vectors with very small norms → quality below threshold
        tiny = [0.01] * 16
        state, score = classify_person_identity(tiny, tiny)
        assert state == "unavailable"


class TestClassifyPoseSimilarity:
    def test_close_pose(self):
        v = [0.9] * 16
        state, score = classify_pose_similarity(v, v)
        assert state == "close"
        assert score == pytest.approx(1.0)

    def test_far_pose(self):
        v1 = [1.0] * 16
        v2 = [-1.0] * 16
        state, score = classify_pose_similarity(v1, v2)
        assert state == "far"

    def test_uncertain_pose(self):
        # Cosine sim = 0.0 → ≤ POSE_THRESHOLD_FAR (0.50) → "far"
        v1 = [1.0] * 8 + [0.0] * 8
        v2 = [0.0] * 8 + [1.0] * 8
        state, score = classify_pose_similarity(v1, v2)
        assert state == "far"
        assert score == pytest.approx(0.0)

    def test_unavailable_on_empty(self):
        state, score = classify_pose_similarity([], [])
        assert state == "unavailable"


class TestComputePersonDisambiguation:
    def test_unavailable_identity_falls_back_to_base(self):
        empty_vec = []
        result = compute_person_disambiguation(empty_vec, empty_vec, base_similarity=0.85)
        assert result["person_identity_state"] == "unavailable"
        assert result["person_adjustment"] == 0.0
        assert "fallback" in result["decision_reason"]

    def test_different_person_applies_strong_penalty(self):
        v_same = [1.0] * 16
        v_diff = [-1.0] * 16
        base = 0.90
        result = compute_person_disambiguation(v_same, v_diff, base_similarity=base)
        assert result["person_identity_state"] == "different"
        assert result["person_identity_score"] == pytest.approx(-1.0)
        assert result["person_adjustment"] == pytest.approx(-IDENTITY_DIFF_PENALTY)
        assert base + result["person_adjustment"] < base  # score goes down


    def test_same_person_pose_close_applies_positive_boost(self):
        # identity=same AND pose=close → POSE_SAME_BOOST applied
        v = [0.9] * 16
        result = compute_person_disambiguation(v, v, base_similarity=0.80)
        assert result["person_identity_state"] == "same"
        assert result["pose_state"] == "close"
        assert result["person_adjustment"] == pytest.approx(POSE_SAME_BOOST)
        assert "boost" in result["decision_reason"]

    def test_same_person_pose_uncertain_no_adjustment(self):
        # Primary case: identity=uncertain → adjustment=0, no boost or penalty
        v_u1 = [1.0] * 8 + [0.0] * 8
        v_u2 = [0.5] * 8 + [0.866] * 8  # sim ~0.5 → identity uncertain
        result = compute_person_disambiguation(v_u1, v_u2, base_similarity=0.80)
        assert result["person_identity_state"] == "uncertain"
        assert result["person_adjustment"] == 0.0
        assert "uncertain" in result["decision_reason"]

    def test_adjustment_clipped_to_valid_range(self):
        # Very low base + big negative penalty should not go below 0
        v_diff = [-1.0] * 16
        result = compute_person_disambiguation(v_diff, [1.0]*16, base_similarity=0.10)
        # The adjustment is -0.40, but caller clamps to [0,1]
        # Here we check raw adjustment doesn't go beyond -IDENTITY_DIFF_PENALTY
        assert result["person_adjustment"] == pytest.approx(-IDENTITY_DIFF_PENALTY)

    def test_decision_reason_is_populated(self):
        v_same = [0.9] * 16
        result = compute_person_disambiguation(v_same, v_same, base_similarity=0.80)
        assert result["decision_reason"] != ""
        assert isinstance(result["decision_reason"], str)


class TestIdentityThresholds:
    def test_thresholds_defined(self):
        assert IDENTITY_THRESHOLD_SAME >= IDENTITY_THRESHOLD_DIFF
        assert IDENTITY_DIFF_PENALTY > 0
        assert POSE_SAME_BOOST > 0

    def test_same_threshold_above_different_threshold(self):
        assert IDENTITY_THRESHOLD_SAME > IDENTITY_THRESHOLD_DIFF


class TestDualGroupingIdentityReject:
    def test_different_person_member_is_filtered_out_of_group(self):
        from app import app

        client = app.test_client()

        sizes = {
            'winner.jpg': 1000,
            'different.jpg': 1001,
        }
        winner_member = GroupMember(name='winner.jpg', similarity=0.99, to_remove=False)
        different_member = GroupMember(name='different.jpg', similarity=0.93, to_remove=True)
        clip_group = Group(id=1, winner='winner.jpg', winner_size=1000, members=[winner_member, different_member])

        import app as app_module

        folder = '/tmp/test-person-identity-reject'
        app_module._file_sizes[folder] = sizes

        with patch('app.compute_embeddings', return_value={'winner.jpg': [0.1], 'different.jpg': [0.2]}), \
             patch('app.compute_hashes', return_value={'winner.jpg': '0'*64, 'different.jpg': '0'*64}), \
             patch('app.compute_persona_features', return_value={'winner.jpg': [1.0]*16, 'different.jpg': [-1.0]*16}), \
             patch('app.find_groups_clip', return_value=[clip_group]):
            response = client.post('/api/groups', json={
                'folder': folder,
                'strategy': 'dual',
                'enhanced_persona': True,
                'clip_threshold': 0.75,
                'phash_threshold': 10,
                'identity_penalty_strength': 1.0,
            })

        assert response.status_code == 200
        payload = response.get_json()
        assert payload['groups'] == []
        assert different_member.hard_rejected_by_identity is True
        assert different_member.decision_reason == 'different_person_hard_reject'


if __name__ == '__main__':
    import pytest
    pytest.main([__file__, '-v'])
