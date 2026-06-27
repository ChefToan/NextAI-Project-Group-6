"use client";

import { createContext, useCallback, useContext, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type NavLoadingValue = {
  /** True while a route/searchParam navigation or refresh is in flight. */
  pending: boolean;
  /** Navigate to a URL, keeping the previous UI on screen until the new data is ready. */
  navigate: (url: string) => void;
  /** Re-fetch the current route's server data. */
  refresh: () => void;
};

const NavLoadingContext = createContext<NavLoadingValue | null>(null);

export function useNavLoading(): NavLoadingValue {
  return (
    useContext(NavLoadingContext) ?? {
      pending: false,
      navigate: () => {},
      refresh: () => {},
    }
  );
}

// Wraps the topbar + toolbar + body so a date-range change (or refresh) keeps the
// stale numbers/charts on screen, dims them, and overlays a spinner until the new
// server render commits. Driven by React's useTransition pending flag.
export function NavLoadingProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const navigate = useCallback(
    (url: string) => startTransition(() => router.push(url)),
    [router],
  );
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  return (
    <NavLoadingContext.Provider value={{ pending, navigate, refresh }}>
      <div className={`nav-region${pending ? " is-loading" : ""}`} aria-busy={pending}>
        {children}
      </div>
    </NavLoadingContext.Provider>
  );
}
