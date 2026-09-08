"""Moving a strategy from paper to live.

One explicit, human-triggered action, downstream of and separate from the kill switch, with
its own audit record. The bar it must clear is in :mod:`core.promotion.gate`; the record of
who cleared it is in :mod:`core.promotion.ledger`.

Nothing in this repository is promoted.
"""

from core.promotion.gate import (
    PromotionAssessment,
    PromotionEvidence,
    PromotionRequirements,
    assess,
)
from core.promotion.ledger import PromotionLedger, PromotionRecord, PromotionState

__all__ = [
    "PromotionAssessment",
    "PromotionEvidence",
    "PromotionLedger",
    "PromotionRecord",
    "PromotionRequirements",
    "PromotionState",
    "assess",
]
