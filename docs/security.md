# Security review

A pass over the twenty common weaknesses of web apps, as of October 2026. For each: what the risk is here, what the app does, and where. "Fixed" marks what this review changed; the rest was already in place and was checked.

| # | Check | Status |
| --- | --- | --- |
| 1 | SQL injection | In place |
| 2 | Cross-site scripting | In place |
| 3 | CSRF | In place, hardened |
| 4 | Insecure file uploads | Not applicable |
| 5 | IDOR / broken object-level authorization | In place |
| 6 | Missing rate limiting | Fixed |
| 7 | Insecure JWT secrets | In place, hardened |
| 8 | Exposed API secrets | In place |
| 9 | Weak password hashing | In place |
| 10 | Missing multi-factor authentication | Fixed |
| 11 | Permissive CORS | In place |
| 12 | Auth tokens in localStorage | In place |
| 13 | Client-side-only permission checks | In place |
| 14 | Missing row-level security | In place, one production bug fixed |
| 15 | Unverified webhook signatures | In place |
| 16 | SSRF | Fixed |
| 17 | Exposed source maps | In place, made explicit |
| 18 | Default credentials | Fixed |
| 19 | Sensitive data in logs | Fixed |
| 20 | Vulnerable dependencies | Fixed (one unreachable advisory left) |

## 1. SQL injection

Every query goes through Prisma's query builder or its tagged-template `$queryRaw`, which sends values as bind parameters. There is no `$queryRawUnsafe` or string-built SQL. Store databases (Supabase) are reached only through the store's own `agent_api` functions, called with parameters, by a role that can do nothing else.

## 2. Cross-site scripting

React escapes everything it renders, and the app has no `dangerouslySetInnerHTML`. The agent's answers are rendered as markdown with raw HTML dropped. Emails escape every value they insert (`escapeHtml` in `packages/tools`). The two-factor QR code is a `data:` image made on the server. `Content-Security-Policy` adds `object-src 'none'` and `base-uri 'self'`.

## 3. CSRF

- Every form is a Next.js server action. Next refuses an action whose `Origin` does not match the host.
- The one cookie-authenticated API route that changes things, the chat (`app/api/stores/[id]/chat/route.ts`), refuses cross-origin requests itself.
- Session cookies are `SameSite=Lax`, so other sites' requests do not carry them.
- New: `form-action 'self'` in the CSP, and `frame-ancestors 'none'` plus `X-Frame-Options: DENY` against clickjacking.

Webhook routes take no cookies; each is authenticated by its signature (item 15).

## 4. Insecure file uploads

The app accepts no file uploads. If uploads are added, they need a size limit, a type check of the content (not the name), storage outside the web root, and download with `Content-Disposition: attachment`.

## 5. IDOR / broken object-level authorization

Every page, server action and API route loads the store through the signed-in owner's database context (`dbForUser`), so a store id from someone else's account finds nothing, whatever the URL says. Row-level security (item 14) enforces the same thing again inside Postgres. Approval links are signed per approval and expire. `packages/db/test/tenant-isolation.test.ts` tries every route from owner A to owner B's rows and expects none to work.

## 6. Rate limiting (fixed)

`rateLimit` in `packages/tools` counts in Redis (fixed windows, shared by every instance), falling back to memory if Redis is down.

| What | Limit |
| --- | --- |
| Log in | 30 per 15 minutes per IP, and 10 per email |
| Two-factor code | 8 per 15 minutes per challenge |
| Sign up | 5 per hour per IP |
| Password reset request | 10 per hour per IP, and 3 per hour per email |
| Password reset submit | 20 per hour per IP |
| Account changes (password, 2FA) | 10 per 15 minutes per account |
| Connecting a store | 10 per 10 minutes per account |
| Chat | 20 messages per minute per account |

Agent spend is limited separately: per-store monthly budgets and the plan's AI allowance stop runs before they start. The client IP is the last `X-Forwarded-For` entry, the one the host's proxy adds, so a client cannot invent its own.

## 7. JWT secrets

Sessions are HS256 JWTs signed with `SESSION_SECRET`, which must be at least 32 characters. Render generates it. The app refuses to sign or verify with a shorter one.

New: each session carries the account's session version, checked against the database on every request. Changing or resetting the password, or **Log out everywhere**, ends every existing session at once. Previously a stolen cookie stayed valid until it expired.

## 8. Exposed API secrets

- No secret has a `NEXT_PUBLIC_` name, so none reaches the browser bundle.
- `.env` is in `.gitignore`, and the git history has no keys.
- Store credentials are encrypted at rest (AES-256-GCM, `CREDENTIALS_ENCRYPTION_KEY`). They are decrypted only inside the MCP server and never shown to the model.
- The agent API and MCP server are private services that require bearer tokens.

## 9. Password hashing

bcrypt with cost 12, everywhere a password is set. Log-in compares against a dummy hash when the email is unknown, so timing does not show which emails have accounts. Passwords are 10 to 200 characters.

## 10. Multi-factor authentication (fixed)

Owners can turn on two-factor sign-in under **Account**.

- It uses TOTP (RFC 6238), so it works with any authenticator app.
- The secret is encrypted like store credentials.
- Turning it on needs a working code. Ten one-time recovery codes are shown once and stored hashed.
- At log-in, a correct password only starts a five-minute challenge. The session starts after the code.
- Turning it off needs the password and a code.

`packages/shared/src/totp.test.ts` checks the implementation against the RFC's test vectors.

## 11. CORS

The app sends no `Access-Control-Allow-*` headers, so browsers refuse other sites' scripts reading its responses. The agent API and MCP server are not reachable from the internet at all.

## 12. Tokens in localStorage

The session is an `httpOnly`, `Secure` (in production), `SameSite=Lax` cookie. Nothing is kept in `localStorage` or `sessionStorage`.

## 13. Client-side-only permission checks

Every check runs on the server: ownership in each action and route, policies in the MCP server before any tool runs, plan limits in the connect action, the Shopify callback, the agent API and the worker. The browser only hides buttons that would be refused anyway.

## 14. Row-level security (one production bug fixed)

All thirteen tenant tables have RLS, with `FORCE ROW LEVEL SECURITY`. The services connect as `storeops_app`, which owns nothing and has only the grants it needs. The few cross-tenant needs are narrow `SECURITY DEFINER` functions, such as looking up a store id from a Shopify domain or counting an owner's stores for their plan.

**Fixed:** with `FORCE` on, those functions were themselves subject to RLS whenever the database owner is not a superuser. That is the case on managed Postgres such as Render, where sign-up would have failed. Locally the owner is a superuser, which bypasses RLS, so tests never saw it. Migration `20261023000100_definer_access` gives the owner role a policy on each table. It was checked against a non-superuser owner. The app role is unaffected.

Also new:

- `users` can only be updated in the columns the app needs. The plan columns change only through billing's definer functions, so a bug in the app cannot grant a plan.
- Password reset tokens are stored as SHA-256 hashes, in a table the app role cannot read. They work once, for 30 minutes.

## 15. Webhook signatures

- **Shopify:** HMAC-SHA256 of the raw body, compared in constant time.
- **WooCommerce:** the same, with each store's own secret.
- **Razorpay** (new): `X-Razorpay-Signature`, HMAC-SHA256 of the raw body with the webhook secret.

All three verify before parsing, and refuse a request without a signature.

## 16. SSRF (fixed)

Owners give the app addresses (WooCommerce and custom connector URLs, Supabase connection strings) that the servers then connect to. Without a check, an owner could point them at the private network: the agent API, Redis, or the host's metadata service.

`assertPublicHost` in `packages/adapters/src/network.ts` resolves each host and refuses:

- loopback, private, link-local, carrier-grade NAT and other non-public ranges, IPv4 and IPv6
- names such as `localhost`, `*.internal` and `*.local`
- Postgres `host` and `hostaddr` parameters that would override the address

HTTP clients do not follow redirects, so a public address cannot bounce a request inward. Local development and tests set `ALLOW_PRIVATE_STORE_HOSTS=1` for their stores on localhost. The dashboard refuses to start in production with it set.

## 17. Source maps

Next.js does not publish browser source maps for production builds. `productionBrowserSourceMaps: false` now says so in `next.config.ts`, and `X-Powered-By` is off.

## 18. Default credentials (fixed)

There are no built-in accounts. The local development passwords in `docker-compose.yml` and `.env.example` are for local databases only. New: `apps/web/instrumentation.ts` stops the dashboard from starting in production if:

- a secret is missing or too short
- the database URL still has the development password
- `ALLOW_PRIVATE_STORE_HOSTS` is set
- `APP_URL` is not HTTPS

## 19. Sensitive data in logs (fixed)

- Errors are logged through `errorSummary`, which keeps the message and drops request objects, headers and bodies. Some libraries put credentials in those.
- Without Resend, development prints emails to the console. Those can hold approval and reset links. In production they are no longer printed; only the subject is logged.
- Passwords, tokens and store credentials are never logged.

## 20. Vulnerable dependencies (fixed)

`pnpm audit` found a PostCSS advisory (through Next.js). It is pinned to a fixed version with `pnpm.overrides`. One advisory remains: `deepmerge-ts`, used only by the Prisma CLI at build time. It is not in the app's runtime and its input is not attacker-controlled. Run `pnpm audit` before each release.

## Also added

- Security headers on every response: CSP (`frame-ancestors`, `base-uri`, `form-action`, `object-src`), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and HSTS in production.
- Password reset by email. The answer is the same whether or not the email has an account, so it does not reveal who signed up.

## Not covered here

- A penetration test by someone other than the authors.
- The Supabase `agent_api` functions each store writes: they run in the store's own database with its own role, and the setup guide says what to grant.
- Account lockout after repeated failures: rate limits slow guessing, but an account is never locked, so an attacker cannot lock an owner out.
