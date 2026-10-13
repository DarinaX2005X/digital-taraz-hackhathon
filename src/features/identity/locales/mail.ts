import type { Locale } from "@/i18n";
import { colorValue } from "@/ui/tokens";
import { identityTranslator } from "./catalog";

export type IdentityMailInput = { kind: "verify" | "reset" | "invite"; locale: Locale; url: string; workspaceName?: string };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export function formatIdentityMail(input: IdentityMailInput): { subject: string; text: string; html: string } {
  if (/[\u0000-\u0020\\]/.test(input.url)) throw new TypeError("Invalid identity mail URL");
  const url = new URL(input.url);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new TypeError("Invalid identity mail URL");
  const workspaceName = input.workspaceName ?? "";
  if (input.kind === "invite" && !workspaceName.trim()) throw new TypeError("Missing invitation workspace");
  const t = identityTranslator(input.locale);
  const subject = t(`identity.mail.${input.kind}.subject`);
  const title = t(`identity.mail.${input.kind}.title`);
  const body = t(`identity.mail.${input.kind}.body`, input.kind === "invite" ? { workspaceName } : {});
  const action = t(`identity.mail.${input.kind}.action`);
  const ignore = t(`identity.mail.${input.kind}.ignore`);
  const fallback = t("identity.mail.linkFallback");
  const signature = t("identity.mail.signature");
  const safe = { title: escapeHtml(title), body: escapeHtml(body), action: escapeHtml(action), ignore: escapeHtml(ignore), fallback: escapeHtml(fallback), signature: escapeHtml(signature), url: escapeHtml(url.href) };
  const text = ["Tirlik", title, body, `${action}: ${url.href}`, ignore, signature].join("\n\n");
  const html = `<!doctype html><html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:${colorValue("canvas")};color:${colorValue("text")};font:16px/1.5 Arial,sans-serif"><main style="max-width:560px;margin:0 auto;padding:32px 20px"><p style="margin:0 0 24px;font-size:28px;font-weight:700">Tirlik</p><h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">${safe.title}</h1><p>${safe.body}</p><p style="margin:24px 0"><a href="${safe.url}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:${colorValue("action")};color:${colorValue("onAction")};font-weight:600;text-decoration:none">${safe.action}</a></p><p style="font-size:14px;color:${colorValue("muted")}">${safe.fallback}<br><a href="${safe.url}" style="color:${colorValue("action")};overflow-wrap:anywhere">${safe.url}</a></p><p style="margin-top:24px;font-size:14px;color:${colorValue("muted")}">${safe.ignore}</p><p style="margin-top:32px;font-size:14px">${safe.signature}</p></main></body></html>`;
  return { subject, text, html };
}
