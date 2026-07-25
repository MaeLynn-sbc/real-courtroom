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

  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
