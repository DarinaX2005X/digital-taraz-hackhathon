import nodemailer from 'nodemailer';
import type { IdentityLocale } from '../contracts';
import { IdentityError } from './http';

export type IdentityMail = { locale: IdentityLocale; url: string } & (
  | { kind: 'reset'; workspaceName?: never }
  | { kind: 'invite'; workspaceName: string }
);
export type IdentityMailFormatter = (mail: IdentityMail) => { subject: string; text: string; html: string };
export interface IdentityMailer { assertReady(): void; send(to: string, mail: IdentityMail): Promise<void> }

export function createIdentityMailer(env: Readonly<Record<string, string | undefined>>, format: IdentityMailFormatter): IdentityMailer {
  const host = env.SMTP_HOST;
  const port = Number(env.SMTP_PORT);
  const from = env.SMTP_FROM;
  const local = host === '127.0.0.1' || host === 'localhost';
  const ready = !!host && Number.isInteger(port) && port > 0 && port <= 65535 && !!from && !/[\r\n]/.test(from) && (local || (!!env.SMTP_USER && !!env.SMTP_PASSWORD && env.SMTP_REQUIRE_TLS === 'true'));
  const transport = ready ? nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: !local,
    auth: local ? undefined : { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true,
  }) : undefined;
  return {
    assertReady() { if (!transport) throw new IdentityError('UNAVAILABLE', 'identity.errors.mailUnavailable'); },
    async send(to, mail) {
      if (!transport) throw new IdentityError('UNAVAILABLE', 'identity.errors.mailUnavailable');
      try {
        const result = await transport.sendMail({ from, to, ...format(mail) });
        if (!result.accepted?.length || result.rejected?.length) throw new Error('MAIL_NOT_ACCEPTED');
      } catch { throw new IdentityError('UNAVAILABLE', 'identity.errors.mailUnavailable'); }
    },
  };
}
