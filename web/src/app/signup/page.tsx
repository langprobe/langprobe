import { redirect } from "next/navigation";

/**
 * /signup is now a thin redirect into the unified /login page with
 * the Sign-up tab pre-selected. We keep the URL alive so existing
 * "Sign up" links continue to work, but the actual surface is the
 * tab-toggled card on /login.
 */

export const dynamic = "force-dynamic";

export default function SignupPage({
  searchParams,
}: {
  searchParams?: { return_to?: string };
}) {
  const params = new URLSearchParams({ tab: "signup" });
  const returnTo = searchParams?.return_to;
  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    params.set("return_to", returnTo);
  }
  redirect(`/login?${params.toString()}`);
}
