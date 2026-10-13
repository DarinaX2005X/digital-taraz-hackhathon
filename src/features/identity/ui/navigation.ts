import { authReturnTo } from "../domain/return-to";

export type AuthReturn = { returnTo?: string; intentToken?: string };

export function authHref(path: "/sign-in" | "/sign-up" | "/auth/reset" | "/auth/verify", destination: AuthReturn = {}): string {
  const query = new URLSearchParams();
  if (destination.returnTo) query.set("returnTo", authReturnTo(destination.returnTo));
  if (destination.intentToken && /^[a-f0-9]{64}$/.test(destination.intentToken)) query.set("intentToken", destination.intentToken);
  return `${path}${query.size ? `?${query}` : ""}`;
}
