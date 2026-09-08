"use client";

/**
 * Navigation, identity and the kill switch around every page.
 *
 * The nav is grouped by what an operator is doing rather than by which service serves it:
 * watching the platform, looking at strategies and their evidence, or administering it.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useAuth } from "@/components/AuthProvider";
import { KillSwitchBanner } from "@/components/KillSwitchBanner";
import { SignIn } from "@/components/SignIn";
import { API_URL } from "@/lib/api";

interface NavItem {
  href: string;
  label: string;
  note?: string;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Live",
    items: [
      { href: "/", label: "Overview" },
      { href: "/markets", label: "Live Markets" },
      { href: "/positions", label: "Positions" },
      { href: "/orders", label: "Orders" },
      { href: "/signals", label: "Signals" },
    ],
  },
  {
    group: "Evidence",
    items: [
      { href: "/strategies", label: "Strategies" },
      { href: "/performance", label: "Performance" },
      { href: "/backtests", label: "Backtests" },
      { href: "/risk", label: "Risk" },
    ],
  },
  {
    group: "Research",
    items: [
      { href: "/ml-models", label: "ML Models", note: "not built" },
      { href: "/ai-analysis", label: "AI Analysis", note: "not built" },
    ],
  },
  {
    group: "Platform",
    items: [
      { href: "/health", label: "System Health" },
      { href: "/config", label: "Configuration" },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { session, ready, signOut } = useAuth();
  const pathname = usePathname();

  if (!ready) return null;
  if (!session) return <SignIn />;

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-name">VYRA</div>
          <div className="brand-sub">Scalper Engine</div>
        </div>
        {NAV.map((group) => (
          <div className="nav-group" key={group.group}>
            <div className="nav-group-label">{group.group}</div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="nav-link"
                data-active={pathname === item.href}
              >
                <span>{item.label}</span>
                {item.note ? <span className="faint">{item.note}</span> : null}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="main">
        <KillSwitchBanner />
        <div className="topbar">
          <span className="faint mono">{API_URL}</span>
          <span className="row">
            <span className="dim">
              {session.subject} · <span className="mono">{session.role}</span>
            </span>
            <button onClick={signOut}>Sign out</button>
          </span>
        </div>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
