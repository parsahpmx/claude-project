"""The research pipeline, and the ways it could lie.

Almost every test here is about leakage, because leakage is the only failure a research
pipeline has that produces *good* numbers. A pipeline that crashes gets fixed; a pipeline
that reports 0.78 AUC from a split that saw the future gets believed.

The last section is structural: a model in this package has no path to a live order, and
that is enforced by the import graph rather than by intention.
"""

from __future__ import annotations

import numpy as np
import pytest

from core.ml.artifact import ModelArtifact
from core.ml.dataset import Dataset
from core.ml.model import MIN_USEFUL_AUC, RegimeClassifier, evaluate, train
from core.ml.splits import MIN_TEST_SAMPLES, MIN_TRAIN_SAMPLES, purged_time_splits

pytest.importorskip("sklearn", reason="scikit-learn is required for the ML pipeline")


def synthetic_dataset(
    rows: int = 600, informative: bool = True, seed: int = 7, horizon: int = 5
) -> Dataset:
    """A dataset with a known answer.

    ``informative=False`` produces labels independent of the features. A pipeline that
    reports skill on that data is leaking, and that is the point of having it.
    """
    rng = np.random.default_rng(seed)
    features = rng.normal(size=(rows, 3))
    if informative:
        logits = 1.4 * features[:, 0] - 0.9 * features[:, 1]
        labels = (rng.uniform(size=rows) < 1 / (1 + np.exp(-logits))).astype(float)
    else:
        labels = (rng.uniform(size=rows) < 0.5).astype(float)
    return Dataset(
        features=features,
        labels=labels,
        timestamps=np.arange(rows, dtype=np.int64) * 60_000_000_000,
        feature_names=("f0", "f1", "f2"),
        instrument_id="CME:MES",
        label_horizon=horizon,
    )


# --------------------------------------------------------------------------------------
# Splits
# --------------------------------------------------------------------------------------


def test_training_always_precedes_testing() -> None:
    for split in purged_time_splits(n_samples=1_000, n_splits=5, label_horizon=5):
        assert split.train.max() < split.test.min()


def test_a_gap_at_least_the_label_horizon_separates_the_halves() -> None:
    """The training sample nearest the boundary has a label drawn from the test period."""
    horizon = 10
    for split in purged_time_splits(n_samples=1_000, n_splits=4, label_horizon=horizon):
        assert split.gap >= horizon, f"only {split.gap} samples of separation"


def test_an_embargo_widens_the_gap() -> None:
    """Features come from trailing windows, so the first test rows are partly training-era."""
    plain = list(purged_time_splits(n_samples=1_000, n_splits=3, label_horizon=5))
    embargoed = list(
        purged_time_splits(n_samples=1_000, n_splits=3, label_horizon=5, embargo=20)
    )
    assert all(e.gap == p.gap + 20 for p, e in zip(plain, embargoed, strict=True))


def test_a_purge_smaller_than_the_horizon_is_refused() -> None:
    """Silently correcting it would hide the caller's misunderstanding."""
    with pytest.raises(ValueError, match="smaller than the label horizon"):
        list(purged_time_splits(n_samples=500, label_horizon=10, purge=2))


def test_folds_never_overlap_each_other_in_test_data() -> None:
    seen: set[int] = set()
    for split in purged_time_splits(n_samples=1_200, n_splits=5, label_horizon=3):
        indices = set(split.test.tolist())
        assert not (indices & seen), "two folds tested on the same rows"
        seen |= indices


def test_a_dataset_too_small_to_split_yields_nothing() -> None:
    """Rather than one fold of four samples with a number attached."""
    assert list(purged_time_splits(n_samples=3, n_splits=5, label_horizon=1)) == []


def test_a_fold_too_small_to_mean_anything_is_skipped() -> None:
    """The floors are not preferences.

    Before they existed, a 60-sample dataset produced five folds whose training sets were
    5, 15, 25, 35 and 45 rows. On pure noise the last of those scored an AUC of 0.73, and
    that number was averaged into the verdict with the same weight as a fold trained on
    thousands.
    """
    assert list(purged_time_splits(n_samples=60, n_splits=5, label_horizon=5)) == []
    folds = list(purged_time_splits(n_samples=600, n_splits=5, label_horizon=5))
    assert folds
    assert all(len(f.train) >= MIN_TRAIN_SAMPLES for f in folds)
    assert all(len(f.test) >= MIN_TEST_SAMPLES for f in folds)


def test_a_dataset_of_eighty_rows_reports_insufficient_evidence() -> None:
    """End to end: the floors turn a fake result into an honest absence of one."""
    rng = np.random.default_rng(0)
    tiny = Dataset(
        features=rng.normal(size=(80, 3)),
        labels=(rng.uniform(size=80) < 0.5).astype(float),
        timestamps=np.arange(80, dtype=np.int64) * 60_000_000_000,
        feature_names=("a", "b", "c"),
        instrument_id="X",
        label_horizon=5,
    )
    result = train(tiny, model_id="tiny", dataset_sha256="x", n_splits=5)
    assert result.verdict == "INSUFFICIENT_EVIDENCE"
    assert result.fold_metrics == []


# --------------------------------------------------------------------------------------
# Leakage
# --------------------------------------------------------------------------------------


def test_uninformative_data_reports_chance_rather_than_skill() -> None:
    """The test that catches leakage anywhere upstream of it.

    Labels here are independent of the features. Any pipeline reporting discrimination on
    this data is reading the answer from somewhere it should not be able to.
    """
    result = train(
        synthetic_dataset(informative=False, seed=3),
        model_id="noise",
        dataset_sha256="sha256:test",
        n_splits=5,
    )
    assert result.verdict == "AT_CHANCE"
    assert not result.is_usable
    assert result.artifact.oos_metrics["auc_mean"] < MIN_USEFUL_AUC
    assert any("does not discriminate" in r for r in result.reasons)


def test_a_result_at_chance_is_reported_not_retried() -> None:
    """A pipeline that searches until the number improves will always find one."""
    result = train(
        synthetic_dataset(informative=False, seed=11),
        model_id="noise",
        dataset_sha256="sha256:test",
    )
    assert result.verdict == "AT_CHANCE"
    assert result.artifact.oos_metrics["folds"] >= 3
    # The artifact still exists and still carries its provenance: a negative result is a
    # result, and it has to be as reproducible as a positive one.
    assert result.artifact.coefficients


def test_a_genuinely_informative_dataset_is_detected() -> None:
    """The counterpart. A pipeline that reports chance on everything is also broken."""
    result = train(
        synthetic_dataset(informative=True, seed=5),
        model_id="signal",
        dataset_sha256="sha256:test",
        n_splits=5,
    )
    assert result.verdict == "ABOVE_CHANCE", result.reasons
    assert result.artifact.oos_metrics["auc_mean"] > MIN_USEFUL_AUC


def test_scaling_uses_training_statistics_only() -> None:
    """The quietest leak there is.

    Standardising with statistics over the whole dataset lets training rows carry
    information about the test rows' distribution — every downstream number comes out
    slightly optimistic with nothing to point at.
    """
    rng = np.random.default_rng(1)
    train_x = rng.normal(loc=0.0, scale=1.0, size=(200, 2))
    test_x = rng.normal(loc=50.0, scale=1.0, size=(50, 2))  # a wildly different regime
    labels = (rng.uniform(size=200) < 0.5).astype(float)

    model = RegimeClassifier(seed=1)
    model.fit(train_x, labels, ("a", "b"))
    scaled = model._scale(test_x)

    # Scaled by the *training* mean, so a shifted test set lands far from zero. Had the
    # scaler seen the test rows, it would sit near zero and the leak would be invisible.
    assert np.abs(scaled).mean() > 10.0


def test_a_constant_feature_does_not_poison_every_prediction() -> None:
    """Zero variance divides by zero, and the NaN propagates into every output."""
    features = np.column_stack(
        [np.random.default_rng(2).normal(size=300), np.ones(300)]
    )
    labels = (np.random.default_rng(3).uniform(size=300) < 0.5).astype(float)
    model = RegimeClassifier(seed=1)
    model.fit(features, labels, ("varies", "constant"))
    assert np.all(np.isfinite(model.predict_proba(features)))


def test_out_of_order_timestamps_are_refused() -> None:
    """Every split here assumes time order and would leak silently without it."""
    with pytest.raises(ValueError, match="time order"):
        Dataset(
            features=np.zeros((3, 1)),
            labels=np.zeros(3),
            timestamps=np.array([3, 1, 2], dtype=np.int64),
            feature_names=("f",),
            instrument_id="CME:MES",
            label_horizon=1,
        )


# --------------------------------------------------------------------------------------
# Honest reporting
# --------------------------------------------------------------------------------------


def test_training_metrics_are_never_filed_as_performance() -> None:
    """They live under a name nobody quotes by accident."""
    result = train(
        synthetic_dataset(informative=True), model_id="m", dataset_sha256="sha256:x"
    )
    assert "auc" in result.artifact.train_metrics
    assert "auc" not in result.artifact.oos_metrics
    assert set(result.artifact.oos_metrics) >= {"auc_mean", "auc_min", "auc_std", "folds"}


def test_accuracy_is_reported_beside_the_base_rate() -> None:
    """On a 95/5 split, 95% accuracy is what predicting the majority every time gets."""
    labels = np.zeros(100)
    labels[:5] = 1.0
    metrics = evaluate(labels, np.full(100, 0.1))
    assert metrics["accuracy"] == metrics["majority_accuracy"] == 0.95
    assert metrics["base_rate"] == 0.05


def test_too_few_folds_is_insufficient_evidence_not_a_verdict() -> None:
    result = train(
        synthetic_dataset(rows=200), model_id="tiny", dataset_sha256="sha256:x", n_splits=2
    )
    assert result.verdict == "INSUFFICIENT_EVIDENCE"
    assert not result.is_usable


def test_a_degenerate_fold_scores_chance_rather_than_raising() -> None:
    """One class in a fold is uninformative, not an error worth losing the run over."""
    labels = np.ones(50)
    assert evaluate(labels, np.random.default_rng(1).uniform(size=50))["auc"] == 0.5


def test_tied_scores_do_not_change_the_auc_by_sort_order() -> None:
    labels = np.array([0.0, 1.0, 0.0, 1.0])
    assert evaluate(labels, np.array([0.5, 0.5, 0.5, 0.5]))["auc"] == 0.5


# --------------------------------------------------------------------------------------
# Provenance
# --------------------------------------------------------------------------------------


def test_a_model_records_the_data_it_trained_on_by_hash(tmp_path) -> None:
    """A path says where the data was; a hash says what it was."""
    result = train(
        synthetic_dataset(),
        model_id="m1",
        dataset_sha256="sha256:abc123",
        dataset_id="mes-2024-03",
        config_hash="sha256:cfg",
        master_seed=42,
    )
    path = result.artifact.write(tmp_path / "m1.json")
    loaded = ModelArtifact.read(path)
    assert loaded.dataset_sha256 == "sha256:abc123"
    assert loaded.config_hash == "sha256:cfg"
    assert loaded.seed == result.artifact.seed
    assert loaded.oos_metrics == result.artifact.oos_metrics


def test_a_model_without_a_dataset_fingerprint_says_so() -> None:
    result = train(synthetic_dataset(), model_id="m", dataset_sha256="")
    assert any("NO_DATASET_FINGERPRINT" in w for w in result.artifact.warnings)
    assert not result.artifact.is_reproducible


def test_the_same_seed_and_data_reproduce_the_same_model() -> None:
    first = train(
        synthetic_dataset(seed=9), model_id="m", dataset_sha256="sha256:x", master_seed=1
    )
    second = train(
        synthetic_dataset(seed=9), model_id="m", dataset_sha256="sha256:x", master_seed=1
    )
    assert first.artifact.coefficients == second.artifact.coefficients
    assert first.artifact.oos_metrics == second.artifact.oos_metrics


def test_a_different_master_seed_is_recorded_even_when_it_changes_nothing() -> None:
    """One number must determine the study, and the artifact records the derived one."""
    a = train(synthetic_dataset(), model_id="m", dataset_sha256="x", master_seed=1)
    b = train(synthetic_dataset(), model_id="m", dataset_sha256="x", master_seed=2)
    assert a.artifact.seed != b.artifact.seed


def test_a_model_refuses_a_feature_set_it_was_not_trained_on() -> None:
    """Order included: a model fed different inputs returns a confident wrong number."""
    artifact = ModelArtifact(
        model_id="m", model_type="logistic_regression", feature_names=("a", "b"),
        dataset_sha256="x", dataset_id="d", config_hash="c", seed=1, label_horizon=5,
    )
    artifact.require_features(("a", "b"))
    with pytest.raises(ValueError, match="was trained on"):
        artifact.require_features(("b", "a"))
    with pytest.raises(ValueError, match="was trained on"):
        artifact.require_features(("a", "b", "c"))


def test_an_artifact_from_an_unknown_format_is_refused(tmp_path) -> None:
    path = tmp_path / "future.json"
    path.write_text('{"version": 99, "model_id": "m"}')
    with pytest.raises(ValueError, match="refusing to load"):
        ModelArtifact.read(path)


# --------------------------------------------------------------------------------------
# No path to a live order
# --------------------------------------------------------------------------------------


def test_the_ml_package_cannot_reach_execution_or_brokers() -> None:
    """Structural, not a policy note.

    A model produces a probability. Turning one into a position is the risk engine's job,
    and the promotion step is what puts a model on the far side of that boundary. If this
    test ever fails, somebody has built the shortcut.
    """
    import pathlib
    import re

    package = pathlib.Path("core/ml")
    forbidden = re.compile(r"^\s*(?:from|import)\s+(core\.execution|core\.brokers|brokers)\b")
    offenders = [
        f"{path}:{n}: {line.strip()}"
        for path in package.rglob("*.py")
        for n, line in enumerate(path.read_text().splitlines(), 1)
        if forbidden.match(line)
    ]
    assert offenders == [], offenders


def test_nothing_in_execution_imports_the_ml_package() -> None:
    """The reverse direction. A model reached through the execution engine is a live path."""
    import pathlib
    import re

    forbidden = re.compile(r"^\s*(?:from|import)\s+core\.ml\b")
    offenders = [
        f"{path}:{n}: {line.strip()}"
        for directory in ("core/execution", "core/brokers", "brokers")
        for path in pathlib.Path(directory).rglob("*.py")
        for n, line in enumerate(path.read_text().splitlines(), 1)
        if forbidden.match(line)
    ]
    assert offenders == [], offenders
