"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

export function useCurrentUser() {
  const { data: session, status, update } = useSession();
  const hasResynced = useRef(false);

  // This app's login goes through a server action + redirect
  // (actions/auth.actions.ts's loginAction, via the server-side signIn())
  // rather than next-auth/react's own client signIn() — so
  // SessionProvider's cached "no session" state from the /login page
  // never gets invalidated by the framework's own signIn()-triggered
  // resync. Found live: the avatar (and anything else reading this hook)
  // rendered as logged-out immediately after a real login, only
  // correcting itself after an unrelated hard reload. update() with no
  // arguments is next-auth's documented way to force the shared client
  // cache to refetch /api/auth/session — this doesn't create a session or
  // touch the login flow, it just tells the already-existing cache to
  // check again. Fires once per mount (the useRef guard) — since this
  // hook's only consumer (UserNav) lives inside the dashboard layout,
  // which mounts exactly once per landing on /dashboard, not on every
  // sub-page click within it.
  useEffect(() => {
    if (!hasResynced.current) {
      hasResynced.current = true;
      void update();
    }
  }, [update]);

  return {
    user: session?.user ?? null,
    isLoading: status === "loading",
    isAuthenticated: status === "authenticated",
  };
}
