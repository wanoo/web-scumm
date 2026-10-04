import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { authorizeStudioRequest } from '../tools/studio/security';

const oldLan = process.env.WEB_SCUMM_LAN;
const oldToken = process.env.WEB_SCUMM_STUDIO_TOKEN;
afterEach(() => {
  if (oldLan === undefined) delete process.env.WEB_SCUMM_LAN; else process.env.WEB_SCUMM_LAN = oldLan;
  if (oldToken === undefined) delete process.env.WEB_SCUMM_STUDIO_TOKEN; else process.env.WEB_SCUMM_STUDIO_TOKEN = oldToken;
});

describe('LAN Studio capability', () => {
  it('requires a token and same-origin writes', async () => {
    process.env.WEB_SCUMM_LAN = '1'; process.env.WEB_SCUMM_STUDIO_TOKEN = 'secret-token';
    const server = createServer((req, res) => { if (authorizeStudioRequest(req, res)) { res.statusCode = 200; res.end('ok'); } });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(base)).status).toBe(401);
      const login = await fetch(`${base}/?token=secret-token`);
      expect(login.status).toBe(200);
      const cookie = login.headers.get('set-cookie')!;
      expect(cookie).toContain('HttpOnly');
      expect((await fetch(base, { method: 'POST', headers: { cookie, origin: base } })).status).toBe(200);
      expect((await fetch(base, { method: 'POST', headers: { cookie, origin: 'https://evil.example' } })).status).toBe(403);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
