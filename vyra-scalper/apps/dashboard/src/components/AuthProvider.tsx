"use client";

/**
 * Who is signed in.
 *
 * The role is read from the token the API issued and is used only to *hide* controls the
 * caller cannot use. It is never the enforcement point: the API checks every request, and
 * a dashboard that decided authorisation for itself would be a second answer to a question
 * that must have one.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { clearSession, login as apiLogin, storedRole, storedSubject, storedToken } from "@/lib/api";
import type { Role } from "@/lib/types";

interface Session {
  subject: string;
  role: Role;
}

interface AuthValue {
  session: Session | null;
  ready: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  /** True when the signed-in role is at least `required`. Presentation only. */
  can: (required: Role) => boolean;
}

const ORDER: Role[] = ["VIEWER", "TRADER", "OPERATOR", "ADMIN"];

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // Rendering is held until the stored token has been read, so a signed-in operator does
  // not see the sign-in screen flash on every navigation.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = storedToken();
    const role = storedRole();
    const subject = storedSubject();
    if (token && role && subject) {
      setSession({ subject, role: role as Role });
    }
    setReady(true);
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const token = await apiLogin(username, password);
    setSession({ subject: username, role: token.role });
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const can = useCallback(
    (required: Role) => {
      if (!session) return false;
      return ORDER.indexOf(session.role) >= ORDER.indexOf(required);
    },
    [session],
  );

  const value = useMemo<AuthValue>(
    () => ({ session, ready, signIn, signOut, can }),
    [session, ready, signIn, signOut, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
