"""Data models for DedupStudio backend."""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from datetime import datetime


@dataclass
class ImageInfo:
    """Image file information."""
    name: str
    size: int
    cached: bool = False


@dataclass
class ScanRequest:
    """Request to scan a folder for images."""
    folder: str


@dataclass
class ScanResponse:
    """Response with scanned images."""
    folder: str
    total: int
    cached: int
    images: List[ImageInfo]


@dataclass
class EmbedRequest:
    """Request to compute CLIP embeddings."""
    folder: str
    images: List[str]


@dataclass
class EmbedResponse:
    """Response with computed embeddings."""
    embeddings: Dict[str, List[float]]


@dataclass
class HashRequest:
    """Request to compute perceptual hashes."""
    folder: str
    images: List[str]


@dataclass
class HashResponse:
    """Response with computed hashes."""
    hashes: Dict[str, str]


@dataclass
class GroupMember:
    """A member within a similarity group."""
    name: str
    similarity: float
    to_remove: bool = False
    hamming_distance: int = 0
    # Persona-enhancement similarity [0, 1], 0 = not computed.
    persona_similarity: float = 0.0
    # 16-dim persona feature vector; empty list = not computed.
    persona_vector: List[float] = None

    # --- Phase 1: Person Disambiguation fields ---
    # Identity state: same | different | uncertain | unavailable
    person_identity_state: str = "unavailable"
    # Raw identity similarity score [0, 1]
    person_identity_score: float = 0.0
    # Pose state: close | far | uncertain | unavailable
    pose_state: str = "unavailable"
    # Pose similarity score [0, 1]
    pose_similarity: float = 0.0
    # Final per-member adjustment applied to base similarity
    person_adjustment: float = 0.0
    # Human-readable decision reason
    decision_reason: str = ""
    # Scene annotation fields for display only.
    scene_type: str = "unknown"
    scene_confidence: float = 0.0
    scene_signals: List[str] = None

    def __post_init__(self):
        if self.persona_vector is None:
            object.__setattr__(self, 'persona_vector', [])
        if self.scene_signals is None:
            object.__setattr__(self, 'scene_signals', [])


@dataclass
class Group:
    """A similarity group of images."""
    id: int
    winner: str
    winner_size: int
    members: List[GroupMember]
    # Whether persona enhancement was active for this group.
    persona_enabled: bool = False
    # Marker for current identity experiment version.
    identity_version: str = "v1"
    # Average persona similarity boost applied to members (legacy compat).
    persona_boost: float = 0.0
    # --- Phase 1: extended fields ---
    # Final decision score for the group (recomputed after disambiguation).
    group_final_score: float = 0.0
    # Overall decision reason for this group.
    group_decision_reason: str = ""
    # Scene annotation fields for display only.
    group_scene_type: str = "unknown"
    group_scene_confidence: float = 0.0
    group_scene_signals: List[str] = field(default_factory=list)


@dataclass
class GroupsRequest:
    """Request to compute similarity groups."""
    folder: str
    strategy: str  # "clip", "hash", "size", "both"
    threshold: float
    loose_threshold: float = 0.85
    clip_threshold: float | None = None
    phash_threshold: int | None = None


@dataclass
class GroupsResponse:
    """Response with computed groups."""
    groups: List[Group]
    stats: Dict[str, int]


@dataclass
class MoveItem:
    """A single file move operation."""
    name: str
    action: str  # "remove" or "keep"


@dataclass
class MoveRequest:
    """Request to move files."""
    folder: str
    moves: List[MoveItem]


@dataclass
class MoveResponse:
    """Response after moving files."""
    success: bool
    moved: int


@dataclass
class UndoRequest:
    """Request to undo last operation."""
    folder: str


@dataclass
class UndoResponse:
    """Response after undo."""
    success: bool
    restored: int


@dataclass
class HistoryEntry:
    """A single history entry."""
    id: int
    time: str
    strategy: str
    threshold: float
    removed: int
    folder: str
    moved_files: List[str] = field(default_factory=list)
    undone: bool = False


@dataclass
class HistoryResponse:
    """Response with operation history."""
    history: List[HistoryEntry]
