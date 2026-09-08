"use client";

/**
 * Configuration.
 *
 * Credentials are removed by the API before the response is built — whole connection blocks
 * go, along with anything credential-shaped — so this page cannot display a broker secret
 * whatever the caller's role. The removal happens at the source rather than here: a client
 * that filtered its own display would still have received the secret.
 */

import { useState } from "react";

import { useApi } from "@/components/useApi";
import { Notice, PageHeader, QueryState } from "@/components/ui";
import { api } from "@/lib/api";
import type { ConfigResponse } from "@/lib/types";

export default function ConfigPage() {
  const config = useApi<ConfigResponse>(() => api.config(), []);
  const [section, setSection] = useState<string | null>(null);

  const sections = Object.keys(config.data?.config ?? {});
  const shown = section ?? sections[0] ?? null;

  return (
    <>
      <PageHeader title="Configuration">
        The configuration the engine loaded, identified by its hash. Read-only: configuration
        is changed in the repository and reviewed, not edited from a browser.
      </PageHeader>

      <Notice tone="info" title="Credentials are removed before the response leaves the API">
        Connection blocks and credential-shaped fields are stripped server-side. What is
        missing below is missing on purpose.
      </Notice>

      <QueryState loading={config.loading && !config.loaded} error={config.error}>
        {config.data ? (
          <>
            <p className="dim">
              Config hash <span className="mono">{config.data.config_hash}</span>
            </p>
            <div className="row" style={{ marginBottom: 14 }}>
              {sections.map((name) => (
                <button
                  key={name}
                  onClick={() => setSection(name)}
                  style={
                    name === shown
                      ? { borderColor: "var(--accent)", color: "var(--accent)" }
                      : undefined
                  }
                >
                  {name}
                </button>
              ))}
            </div>
            <pre className="json">
              {JSON.stringify(shown ? config.data.config[shown] : {}, null, 2)}
            </pre>
          </>
        ) : null}
      </QueryState>
    </>
  );
}
