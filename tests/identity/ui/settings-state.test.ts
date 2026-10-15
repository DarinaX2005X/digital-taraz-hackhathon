import { describe, expect, it } from "vitest";
import { identitySamePageFragment, settingsViewFromHash, settingsViews, shouldConfirmIdentityNavigation } from "@/features/identity/ui/settings-state";

describe("settings navigation and local draft protection", () => {
  it.each(settingsViews)("resolves the direct #%s destination", (view) => {
    expect(settingsViewFromHash(`#${view}`)).toBe(view);
  });

  it.each(["", "#", "#unknown", "#security?token=private", "#%73ecurity", "#profile/../security"])("uses the profile for unknown fragment %j", (hash) => {
    expect(settingsViewFromHash(hash)).toBe("profile");
  });

  const navigation = { dirty: true, currentHref: "http://127.0.0.1:59676/settings#profile", href: "/settings/team" };

  it("requires confirmation for another internal page or query while preserving hash changes", () => {
    expect(shouldConfirmIdentityNavigation(navigation)).toBe(true);
    expect(shouldConfirmIdentityNavigation({ ...navigation, href: "/" })).toBe(true);
    expect(shouldConfirmIdentityNavigation({ ...navigation, href: "/settings?workspace=test" })).toBe(true);
    expect(shouldConfirmIdentityNavigation({ ...navigation, href: "#security" })).toBe(false);
    expect(shouldConfirmIdentityNavigation({ ...navigation, href: "/settings#language" })).toBe(false);
    expect(shouldConfirmIdentityNavigation({ ...navigation, href: "/settings#profile" })).toBe(false);
  });

  it("routes same-page menu and anchor links through native fragments without a Next route replacement", () => {
    expect(identitySamePageFragment({ ...navigation, href: "/settings#security" })).toBe("#security");
    expect(identitySamePageFragment({ ...navigation, href: "#language" })).toBe("#language");
    expect(identitySamePageFragment({ ...navigation, href: "/settings" })).toBe("");
    expect(identitySamePageFragment(navigation)).toBeUndefined();
    expect(identitySamePageFragment({ ...navigation, href: "/settings?other=1#security" })).toBeUndefined();
    expect(identitySamePageFragment({ ...navigation, href: "https://example.test/settings#security" })).toBeUndefined();
    expect(identitySamePageFragment({ ...navigation, href: "#security", modified: true })).toBeUndefined();
  });

  it.each([
    { dirty: false }, { prevented: true }, { button: 1 }, { button: 2 }, { modified: true },
    { target: "_blank" }, { target: "named-window" }, { download: true },
  ])("does not replace native or already handled navigation for %j", (patch) => {
    expect(shouldConfirmIdentityNavigation({ ...navigation, ...patch })).toBe(false);
  });

  it("allows an explicit same-window target and leaves external protocols to native handling", () => {
    expect(shouldConfirmIdentityNavigation({ ...navigation, target: "_self" })).toBe(true);
    expect(shouldConfirmIdentityNavigation({ ...navigation, href: "https://example.test/settings" })).toBe(false);
    expect(shouldConfirmIdentityNavigation({ ...navigation, href: "mailto:person@example.test" })).toBe(false);
    expect(shouldConfirmIdentityNavigation({ ...navigation, href: "javascript:alert(1)" })).toBe(false);
    expect(shouldConfirmIdentityNavigation({ ...navigation, currentHref: "not a URL" })).toBe(false);
  });
});
