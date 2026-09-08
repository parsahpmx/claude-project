"use client";

/**
 * ML Models — not built.
 *
 * The page exists so the gap is visible rather than absent from the navigation. It shows no
 * accuracy figure, no feature importance and no model list, because there is no model: a
 * screen of plausible placeholder metrics for a subsystem that does not exist is how a
 * number nobody computed ends up in a decision.
 */

import { NotBuilt, PageHeader } from "@/components/ui";

export default function MlModelsPage() {
  return (
    <>
      <PageHeader title="ML Models">
        Regime classification and the strategy selector.
      </PageHeader>
      <NotBuilt title="Not built yet">
        <p>
          The regime classifier in this build is rule-based and deterministic — volatility,
          trend and range measures with documented thresholds — and it is what the strategies
          gate on today. No learned model is trained, stored or served.
        </p>
        <p style={{ marginBottom: 0 }}>
          When one exists, this page will show its training window, the walk-forward result
          that justified it, and the date it was last refit. Those are the figures that
          decide whether a model may be used; accuracy on its own training period is not one
          of them.
        </p>
      </NotBuilt>
    </>
  );
}
