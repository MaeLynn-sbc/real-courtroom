"use client";

import { Menu } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface SiteHeaderMobileMenuProps {
  navLinks: { href: string; label: string }[];
}

// Reported live: below md, site-header.tsx's desktop nav (About/Courts/
// Rates/Contact/[Open Play]) and its "Find my booking"/"Sign in" links
// are just `hidden` — no mobile menu ever replaces them, so on a phone
// they're unreachable from the header at all (Sign in isn't in the
// footer either — services/../site-footer.tsx's own NAV_LINKS has no
// /login entry). Purely additive: the existing responsive-visible
// elements are untouched, this only adds an md:hidden fallback trigger
// so nothing is a dead end below md regardless of the exact breakpoint
// (sm vs md) an individual link happens to use.
export function SiteHeaderMobileMenu({ navLinks }: SiteHeaderMobileMenuProps) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="text-bone hover:bg-navy-800 hover:text-bone md:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-5" aria-hidden="true" />
          </Button>
        }
      />
      <SheetContent side="right" className="w-64">
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 p-3 text-sm font-semibold">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className="hover:bg-accent rounded-lg px-3 py-2">
              {link.label}
            </Link>
          ))}
          <Link href="/lookup" className="hover:bg-accent rounded-lg px-3 py-2">
            Find my booking
          </Link>
          <Link href="/login" className="hover:bg-accent rounded-lg px-3 py-2">
            Sign in
          </Link>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
