# Security policy

Please report vulnerabilities through GitHub’s private Security Advisory feature rather than a public issue. Include the affected commit, reproduction steps and impact; do not include provider keys or private game assets.

The development Studio listens on loopback by default. `npm run studio:lan` and `npm run dev:lan` are explicit LAN modes: they generate a one-session capability token, require same-origin writes and print the authorized URL. Do not forward these development ports to the Internet.

Game TypeScript modules and custom commands are trusted code. web-scumm does not sandbox an untrusted `games/<id>` directory. Assistant provider keys live in session storage, and custom relay destinations require the explicit `WEB_SCUMM_ALLOW_CUSTOM_PROVIDER=1` opt-in; public HTTPS destinations are still required.

Supported security fixes target the latest release line. The sample’s non-commercial music is clearly marked and must be replaced in a commercial game; licensing questions are documented in `CREDITS.md` and `LICENSE-ASSETS`.
