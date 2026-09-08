"""Training and out-of-sample evaluation.

Logistic regression, deliberately, as the first model. It is the one whose coefficients can
be read, whose failure modes are known, and which cannot memorise its way to a good training
score — so when the out-of-sample number comes back at chance, the answer is about the
features rather than about the optimiser. The specification's progression
(LR → RF → gradient boosting) starts here for that reason, and moving on is a decision to
take *after* a linear model has been shown to be the limitation.

**Only out-of-sample numbers are performance.** Training metrics are computed and stored
under a name nobody will quote by accident, because a training score that looks good is the
single most common way a research pipeline lies to the person running it.

**A result at chance is a result.** :func:`train` reports it and marks the model as not
usable. It does not retry with different parameters — a pipeline that searches until the
number improves is a pipeline that will always find one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from core.ml.artifact import ModelArtifact
from core.ml.dataset import Dataset
from core.ml.splits import purged_time_splits
from core.util.ids import derive_seed
from core.util.logging import get_logger

__all__ = ["RegimeClassifier", "TrainingResult", "evaluate"]

_log = get_logger("ml.model")

# Below this, out-of-sample discrimination is indistinguishable from a coin toss on any
# sample this platform can produce. Stated as a constant so nobody has to decide it while
# looking at a result they want to like.
MIN_USEFUL_AUC = 0.55

# Fewer folds than this and the out-of-sample estimate is one number with no error bar.
MIN_FOLDS = 3


@dataclass(slots=True)
class TrainingResult:
    """What training produced, and whether it is worth anything."""

    artifact: ModelArtifact
    fold_metrics: list[dict[str, float]] = field(default_factory=list)
    verdict: str = "UNKNOWN"
    reasons: list[str] = field(default_factory=list)

    @property
    def is_usable(self) -> bool:
        """Whether the model cleared the bar. Never a judgement about profitability.

        A model that discriminates is not an edge: it has not met a cost model, a risk
        limit or a fill. This says only that the number is above chance.
        """
        return self.verdict == "ABOVE_CHANCE"

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "is_usable": self.is_usable,
            "reasons": list(self.reasons),
            "folds": list(self.fold_metrics),
            "artifact": self.artifact.to_dict(),
        }


def _auc(labels: np.ndarray, scores: np.ndarray) -> float:
    """Rank-based AUC.

    Computed here rather than imported so a degenerate fold — one class only — returns 0.5
    instead of raising. A fold with one class is uninformative, not an error, and dropping
    the whole run because of one is worse than reporting chance for it.
    """
    positives = labels == 1
    negatives = ~positives
    if not positives.any() or not negatives.any():
        return 0.5
    order = np.argsort(scores, kind="mergesort")
    ranks = np.empty(len(scores), dtype=float)
    ranks[order] = np.arange(1, len(scores) + 1, dtype=float)
    # Average ranks within ties, or identical scores would produce an AUC that depended on
    # the sort's tie-breaking.
    sorted_scores = scores[order]
    start = 0
    for index in range(1, len(sorted_scores) + 1):
        if index == len(sorted_scores) or sorted_scores[index] != sorted_scores[start]:
            if index - start > 1:
                ranks[order[start:index]] = ranks[order[start:index]].mean()
            start = index
    n_pos = int(positives.sum())
    n_neg = int(negatives.sum())
    return float((ranks[positives].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def evaluate(labels: np.ndarray, probabilities: np.ndarray) -> dict[str, float]:
    """Metrics for one fold.

    Accuracy is reported alongside the base rate on purpose: on a 95/5 split, 95% accuracy
    is what you get for predicting the majority every time.
    """
    if len(labels) == 0:
        return {"auc": 0.5, "accuracy": 0.0, "base_rate": 0.0, "samples": 0.0}
    predictions = (probabilities >= 0.5).astype(float)
    base_rate = float(np.mean(labels))
    return {
        "auc": round(_auc(labels, probabilities), 6),
        "accuracy": round(float(np.mean(predictions == labels)), 6),
        "base_rate": round(base_rate, 6),
        "majority_accuracy": round(max(base_rate, 1.0 - base_rate), 6),
        "samples": float(len(labels)),
    }


class RegimeClassifier:
    """A logistic regression over engine features.

    Args:
        seed: derived from the caller's master seed, so one number reproduces the whole
            study rather than each component carrying its own.
    """

    __slots__ = ("_columns", "_model", "_scaler_mean", "_scaler_std", "_seed")

    def __init__(self, seed: int = 0, **parameters: Any) -> None:
        try:
            from sklearn.linear_model import LogisticRegression
        except ImportError as exc:  # pragma: no cover - dependency is declared
            raise RuntimeError(
                "scikit-learn is required to train models; pip install '.[ml]'"
            ) from exc
        self._seed = seed
        defaults: dict[str, Any] = {"C": 1.0, "max_iter": 1_000, "solver": "lbfgs"}
        defaults.update(parameters)
        self._model = LogisticRegression(random_state=seed, **defaults)
        self._scaler_mean: np.ndarray | None = None
        self._scaler_std: np.ndarray | None = None
        self._columns: tuple[str, ...] = ()

    @property
    def parameters(self) -> dict[str, Any]:
        return {k: v for k, v in self._model.get_params().items() if k != "random_state"}

    def fit(self, features: np.ndarray, labels: np.ndarray, columns: tuple[str, ...]) -> None:
        """Fit, standardising features using **training statistics only**.

        Scaling with statistics computed over the whole dataset is the quietest leak there
        is: the training rows would carry information about the test rows' distribution,
        and every metric downstream would be slightly optimistic with nothing to point at.
        """
        self._columns = columns
        self._scaler_mean = features.mean(axis=0)
        std = features.std(axis=0)
        # A constant column has zero variance; dividing by it produces NaN, which then
        # propagates silently into every prediction.
        self._scaler_std = np.where(std > 0, std, 1.0)
        self._model.fit(self._scale(features), labels)

    def _scale(self, features: np.ndarray) -> np.ndarray:
        assert self._scaler_mean is not None and self._scaler_std is not None
        scaled: np.ndarray = (features - self._scaler_mean) / self._scaler_std
        return scaled

    def predict_proba(self, features: np.ndarray) -> np.ndarray:
        """Probability of the positive class. Advisory: it is not a position."""
        probabilities: np.ndarray = np.asarray(
            self._model.predict_proba(self._scale(features))
        )
        return probabilities[:, 1]

    @property
    def coefficients(self) -> list[float]:
        return [float(c) for c in self._model.coef_[0]]

    @property
    def intercept(self) -> float:
        return float(self._model.intercept_[0])


def train(
    dataset: Dataset,
    model_id: str,
    dataset_sha256: str,
    dataset_id: str = "",
    config_hash: str = "",
    master_seed: int = 0,
    n_splits: int = 5,
    embargo: int = 0,
    **parameters: Any,
) -> TrainingResult:
    """Train and evaluate out of sample. Reports what it finds, including nothing.

    The final model is refit on all data — that is the model you would deploy — but every
    number reported comes from the folds, where the data it was scored on was not the data
    it was fit on.
    """
    seed = derive_seed(master_seed, f"ml:{model_id}")
    artifact = ModelArtifact(
        model_id=model_id,
        model_type="logistic_regression",
        feature_names=dataset.feature_names,
        dataset_sha256=dataset_sha256,
        dataset_id=dataset_id,
        config_hash=config_hash,
        seed=seed,
        label_horizon=dataset.label_horizon,
    )
    if not dataset_sha256:
        artifact.add_warning(
            "NO_DATASET_FINGERPRINT: the training data is identified by name only, so this "
            "model cannot be reproduced from what it records"
        )

    folds: list[dict[str, float]] = []
    for split in purged_time_splits(
        n_samples=len(dataset),
        n_splits=n_splits,
        label_horizon=dataset.label_horizon,
        embargo=embargo,
    ):
        model = RegimeClassifier(seed=seed, **parameters)
        train_x = dataset.features[split.train]
        if len(np.unique(dataset.labels[split.train])) < 2:
            # One class in training: the model cannot learn a boundary, and scoring it
            # would report the base rate as skill.
            continue
        model.fit(train_x, dataset.labels[split.train], dataset.feature_names)
        probabilities = model.predict_proba(dataset.features[split.test])
        metrics = evaluate(dataset.labels[split.test], probabilities)
        metrics["train_samples"] = float(len(split.train))
        metrics["gap"] = float(split.gap)
        folds.append(metrics)

    reasons: list[str] = []
    if len(folds) < MIN_FOLDS:
        reasons.append(
            f"only {len(folds)} usable fold(s); {MIN_FOLDS} are needed before an "
            "out-of-sample number means anything"
        )
        verdict = "INSUFFICIENT_EVIDENCE"
    else:
        mean_auc = float(np.mean([f["auc"] for f in folds]))
        artifact.oos_metrics = {
            "auc_mean": round(mean_auc, 6),
            "auc_min": round(min(f["auc"] for f in folds), 6),
            "auc_std": round(float(np.std([f["auc"] for f in folds])), 6),
            "accuracy_mean": round(float(np.mean([f["accuracy"] for f in folds])), 6),
            "majority_accuracy_mean": round(
                float(np.mean([f["majority_accuracy"] for f in folds])), 6
            ),
            "folds": float(len(folds)),
        }
        if mean_auc < MIN_USEFUL_AUC:
            reasons.append(
                f"out-of-sample AUC {mean_auc:.4f} is below {MIN_USEFUL_AUC}; the model "
                "does not discriminate on data it was not fit to"
            )
            verdict = "AT_CHANCE"
        else:
            verdict = "ABOVE_CHANCE"

    # The deployable model, refit on everything. Its training metrics are recorded under a
    # name nobody quotes as performance.
    final = RegimeClassifier(seed=seed, **parameters)
    if len(np.unique(dataset.labels)) >= 2 and len(dataset) > 0:
        final.fit(dataset.features, dataset.labels, dataset.feature_names)
        artifact.coefficients = final.coefficients
        artifact.intercept = final.intercept
        artifact.parameters = final.parameters
        artifact.train_metrics = evaluate(
            dataset.labels, final.predict_proba(dataset.features)
        )

    result = TrainingResult(artifact=artifact, fold_metrics=folds, verdict=verdict, reasons=reasons)
    _log.info(
        "ml_training_complete",
        model_id=model_id,
        verdict=verdict,
        folds=len(folds),
        oos_auc=artifact.oos_metrics.get("auc_mean"),
        reproducible=artifact.is_reproducible,
    )
    return result
