// What `npm run dev:lan` / `studio:lan` start (tools/serve.ts), computed from the flags and the environment.
export interface ServePlan {
  args: string[];
  env: Record<string, string>;
  token?: string;
  banner: string[];
}

export function serveArgs(
  argv: string[],
  env: Record<string, string | undefined>,
  randomToken: () => string,
): ServePlan {
  const lan = argv.includes('--lan');
  const studio = argv.includes('--studio');
  const token = lan ? env.WEB_SCUMM_STUDIO_TOKEN || randomToken() : undefined;
  const args = ['vite'];
  if (lan) args.push('--host', '0.0.0.0');
  if (studio) args.push('--open', lan ? `/__studio/?token=${token}` : '/__studio/');
  const banner = lan
    ? [
        '',
        'LAN write access is protected by this one-session token:',
        `  ${token}`,
        `Studio: http://<this-machine>:5173/__studio/?token=${token}`,
        `Layout editor: http://<this-machine>:5173/?edit=<room>&token=${token}`,
        '',
      ]
    : [];
  return {
    args,
    env: { ...(lan ? { WEB_SCUMM_LAN: '1', WEB_SCUMM_STUDIO_TOKEN: token! } : {}), ...(studio ? { STUDIO: '1' } : {}) },
    token,
    banner,
  };
}
