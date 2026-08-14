import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/auth.config";
import { CHANGE_PASSWORD_PATH, canAccessRoute, requiresPasswordChangeRedirect } from "@/lib/rbac";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const session = req.auth;

  const decision = canAccessRoute(
    nextUrl.pathname,
    Boolean(session?.user),
    session?.user.permissions ?? [],
  );

  if (decision === "unauthenticated") {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Checked before the permission decision below — a must-change account
  // is authenticated (decision would otherwise be "allowed" or "forbidden"
  // on its own merits) but still gets routed to exactly one place. Direct
  // URL entry to anything else under /dashboard refuses here, server-side,
  // regardless of what the request otherwise looks like.
  if (requiresPasswordChangeRedirect(nextUrl.pathname, Boolean(session?.user.mustChangePassword))) {
    return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, nextUrl));
  }

  if (decision === "forbidden") {
    return NextResponse.redirect(new URL("/unauthorized", nextUrl));
  }

  // Real incident (2026-08-14): middleware runs on the Edge runtime
  // (auth.config.ts's own comment — no Prisma, no jwt() callback), so the
  // session it reads here is whatever was already baked into the
  // request's JWT cookie. A password reset or permission change updates
  // the database immediately, but an already-signed-in browser keeps
  // presenting its OLD cookie until that session naturally re-issues —
  // this middleware layer has no way to know it's stale. The forwarded
  // pathname lets app/dashboard/layout.tsx (a real Node Server Component,
  // where auth()'s jwt() callback DOES re-check the database on every
  // call — see auth.ts's own "re-checked on every call" comment) run the
  // exact same two checks again with a guaranteed-fresh session, so a
  // reset/revocation/deactivation takes effect on the very next request
  // instead of only after the affected account happens to sign out.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
