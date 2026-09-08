"use client";

/**
 * AI Analysis — not built.
 *
 * Worth stating plainly on the page itself: when this exists, its output will be advisory.
 * An LLM cannot place an order, size a position, or alter a risk limit in this
 * architecture — not as a configuration choice, but because no such path is built.
 */

import { NotBuilt, PageHeader } from "@/components/ui";

export default function AiAnalysisPage() {
  return (
    <>
      <PageHeader title="AI Analysis">
        Post-session commentary on what the engine did and why.
      </PageHeader>
      <NotBuilt title="Not built yet">
        <p>
          The planned scope is explanatory: summarise a session&apos;s trades, group refusals
          by reason code, and describe what changed against previous sessions. It reads the
          same artefacts this console reads.
        </p>
        <p style={{ marginBottom: 0 }}>
          It will have no authority. Orders, sizing and risk limits are decided by the risk
          engine alone, and there is no interface through which a language model could reach
          them. Anything shown here will be commentary on decisions already made.
        </p>
      </NotBuilt>
    </>
  );
}
