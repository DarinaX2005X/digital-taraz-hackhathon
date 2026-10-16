import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocked.createTransport } }));
import { createIdentityMailer } from '../../../src/features/identity/server/mail';

const format = () => ({ subject: 'Synthetic subject', text: 'Synthetic message', html: '<p>Synthetic message</p>' });
beforeEach(() => {
  mocked.createTransport.mockReset().mockReturnValue({ sendMail: mocked.sendMail });
  mocked.sendMail.mockReset().mockResolvedValue({ accepted: ['synthetic@example.test'], rejected: [] });
});
describe('transactional mail configuration', () => {
  it('uses unauthenticated loopback SMTP only for the local Mailpit path', async () => {
    const mailer = createIdentityMailer({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_FROM: 'Tirlik tests <no-reply@tirlik.invalid>' }, format);
    mailer.assertReady();
    await mailer.send('synthetic@example.test', { kind: 'reset', locale: 'ru', url: 'http://127.0.0.1:3000/auth/reset?token=synthetic' });
    expect(mocked.createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined, requireTLS: false, disableFileAccess: true, disableUrlAccess: true }));
    expect(mocked.sendMail).toHaveBeenCalledOnce();
  });
  it('requires explicit sender, credentials and TLS for nonlocal mail', () => {
    const config = { SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_USER: 'synthetic', SMTP_PASSWORD: 'synthetic-secret', SMTP_REQUIRE_TLS: 'true', SMTP_FROM: 'Tirlik <sender@example.test>' };
    for (const broken of [{ ...config, SMTP_FROM: '' }, { ...config, SMTP_PASSWORD: '' }, { ...config, SMTP_REQUIRE_TLS: 'false' }, { ...config, SMTP_FROM: 'sender@example.test\r\nBcc: unexpected@example.test' }]) expect(() => createIdentityMailer(broken, format).assertReady()).toThrow('identity.errors.mailUnavailable');
    expect(mocked.createTransport).not.toHaveBeenCalled();
    createIdentityMailer(config, format).assertReady();
    expect(mocked.createTransport).toHaveBeenCalledWith(expect.objectContaining({ requireTLS: true, secure: false }));
  });
  it('does not claim delivery when the transport rejects the recipient or fails', async () => {
    const mailer = createIdentityMailer({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_FROM: 'no-reply@tirlik.invalid' }, format);
    mocked.sendMail.mockResolvedValueOnce({ accepted: [], rejected: ['synthetic@example.test'] });
    await expect(mailer.send('synthetic@example.test', { kind: 'reset', locale: 'en', url: 'http://127.0.0.1:3000/auth/reset' })).rejects.toMatchObject({ code: 'UNAVAILABLE', messageKey: 'identity.errors.mailUnavailable' });
    mocked.sendMail.mockRejectedValueOnce(new Error('provider detail containing credentials'));
    await expect(mailer.send('synthetic@example.test', { kind: 'reset', locale: 'en', url: 'http://127.0.0.1:3000/auth/reset' })).rejects.toThrow('identity.errors.mailUnavailable');
  });
});
