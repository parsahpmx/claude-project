"use client";

/** Small presentational primitives shared by every page. */

import type { ReactNode } from "react";

import { label, num } from "@/lib/format";
import type { Row } from "@/lib/types";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      {children ? <p className="page-sub">{children}</p> : null}
    </>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "bad";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="notice" data-tone={tone}>
      {title ? <div className="notice-title">{title}</div> : null}
      <div>{children}</div>
    </div>
  );
}

export function StatCard({
  title,
  value,
  note,
  tone,
}: {
  title: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "profit" | "loss";
}) {
  return (
    <div className="card">
      <p className="card-title">{title}</p>
      <div className={`card-value${tone ? ` ${tone}` : ""}`}>{value}</div>
      {note ? <div className="card-note">{note}</div> : null}
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone?: "good" | "bad" | "warn";
  children: ReactNode;
}) {
  return (
    <span className="badge" {...(tone ? { "data-tone": tone } : {})}>
      {children}
    </span>
  );
}

/** Yes/no as a badge. Green means the answer is the safe one, not merely "true". */
export function BoolBadge({
  value,
  goodWhen = true,
  labels = ["yes", "no"],
}: {
  value: boolean;
  goodWhen?: boolean;
  labels?: [string, string];
}) {
  return (
    <Badge tone={value === goodWhen ? "good" : "bad"}>{value ? labels[0] : labels[1]}</Badge>
  );
}

export function QueryState({
  loading,
  error,
  empty,
  emptyMessage = "Nothing to show.",
  children,
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}) {
  if (error) {
    return (
      <Notice tone="bad" title="Could not load this from the API">
        {error}
      </Notice>
    );
  }
  if (loading) return <p className="dim">Loading…</p>;
  if (empty) return <p className="dim">{emptyMessage}</p>;
  return <>{children}</>;
}

/**
 * A table over rows whose columns are not known ahead of time.
 *
 * Engine artefacts gain fields as the platform grows. Deriving the columns from the rows
 * means a new field appears in the console the day it is written, instead of silently not
 * being displayed until someone updates a hardcoded list.
 */
export function DataTable({
  rows,
  columns,
  emptyMessage = "No rows.",
}: {
  rows: Row[];
  columns?: string[];
  emptyMessage?: string;
}) {
  if (rows.length === 0) return <p className="dim">{emptyMessage}</p>;
  const keys =
    columns ??
    Array.from(
      rows.reduce<Set<string>>((set, row) => {
        Object.keys(row).forEach((key) => set.add(key));
        return set;
      }, new Set<string>()),
    );

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {keys.map((key) => (
              <th key={key}>{label(key)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {keys.map((key) => {
                const value = row[key];
                const numeric = typeof value === "number";
                return (
                  <td key={key} className={numeric ? "num" : undefined}>
                    {renderCell(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCell(value: unknown): ReactNode {
  if (value === null || value === undefined) return <span className="faint">—</span>;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    return <span className={value < 0 ? "loss" : undefined}>{num(value, 4)}</span>;
  }
  if (typeof value === "object") return <span className="faint">{JSON.stringify(value)}</span>;
  return String(value);
}

/**
 * Key/value pairs before and after costs, side by side.
 *
 * Always rendered as a pair. The single rule the platform will not bend on is that a
 * result before costs is not a result, so the console has no way to show one alone.
 */
export function GrossNetTable({
  gross,
  net,
}: {
  gross: Record<string, unknown>;
  net: Record<string, unknown>;
}) {
  // `label` is the metric block's own description of itself ("before costs" / "after
  // costs"), which the column headers already say. It is dropped rather than rendered as a
  // metric whose value is a sentence.
  const keys = Array.from(new Set([...Object.keys(gross), ...Object.keys(net)]))
    .filter((key) => key !== "label")
    .sort();
  if (keys.length === 0) return <p className="dim">This run recorded no metrics.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Gross (before costs)</th>
            <th>Net (after costs)</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <td>{label(key)}</td>
              <td className="num faint">{renderCell(gross[key])}</td>
              <td className="num">{renderCell(net[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A page for something the engine does not have yet.
 *
 * Deliberately blunt. A screen that renders plausible-looking placeholder numbers for an
 * unbuilt subsystem is worse than no screen: someone will eventually read them as real.
 */
export function NotBuilt({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Notice tone="warn" title={title}>
      {children}
    </Notice>
  );
}
