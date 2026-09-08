"""Feature engineering, model training, and out-of-sample evaluation.

**Nothing here can reach a live order.** Not by policy — by construction: this package
imports no execution or broker module, and a test asserts the reverse direction too. A model
produces a probability; turning one into a position is the risk engine's job, and putting a
model on the far side of that boundary is what Item 7's promotion step is for.

The three rules the module is built around:

* **Features are computed by the engine the strategies use.** Not a parallel
  implementation. A research feature that differs from the traded one produces a backtest
  about a system nobody is running.
* **Splits are purged and embargoed.** A label looks forward by construction, so a training
  sample whose label window overlaps the test period has seen the test period.
* **Only out-of-sample numbers are performance.** Training metrics are recorded for
  diagnosis and are never reported as a result.
"""

from core.ml.artifact import ModelArtifact
from core.ml.dataset import Dataset, build_dataset
from core.ml.model import RegimeClassifier, TrainingResult, evaluate, train
from core.ml.splits import PurgedSplit, purged_time_splits

__all__ = [
    "Dataset",
    "ModelArtifact",
    "PurgedSplit",
    "RegimeClassifier",
    "TrainingResult",
    "build_dataset",
    "evaluate",
    "purged_time_splits",
    "train",
]
