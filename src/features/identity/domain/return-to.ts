const allowedRoots = ['/app', '/settings', '/demo'];

export function safeReturnTo(input: unknown): string {
  if (typeof input !== 'string' || input.length > 1024 || /[\\\u0000-\u0020\u007f]/.test(input) || !input.startsWith('/') || input.startsWith('//')) return '/app';
  try {
    const url = new URL(input, 'https://tirlik.invalid');
    if (url.origin !== 'https://tirlik.invalid' || !allowedRoots.some((root) => url.pathname === root || url.pathname.startsWith(`${root}/`))) return '/app';
    // Only explicitly supported opaque navigation state survives authentication.
    const intent = url.searchParams.get('intent');
    return `${url.pathname}${intent && /^[a-f0-9]{64}$/.test(intent) ? `?intent=${intent}` : ''}`;
  } catch { return '/app'; }
}

export function authReturnTo(input: unknown, intentToken?: string): string {
  const target = new URL(safeReturnTo(input), 'https://tirlik.invalid');
  if (intentToken && /^[a-f0-9]{64}$/.test(intentToken)) target.searchParams.set('intent', intentToken);
  return `${target.pathname}${target.search}`;
}
