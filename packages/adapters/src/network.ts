import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AdapterError } from "./adapter";

/**
 * Owners type in the address of their store (a connector URL, a WooCommerce
 * site, a Postgres host) and our servers connect to it. Without a check, that
 * address could point inside our own network: the internal MCP server, the
 * database, a cloud metadata endpoint. So every store address must resolve to
 * public addresses only, unless ALLOW_PRIVATE_STORE_HOSTS=1 (local
 * development and tests, where the test stores run on localhost).
 */

export function privateHostsAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_STORE_HOSTS === "1";
}

function ipv4Private(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // this network, private, loopback, multicast and reserved
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) // benchmarking
  );
}

/** True for loopback, private, link-local, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return ipv4Private(ip);
  if (version === 6) {
    const v6 = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return ipv4Private(mapped[1]!);
    return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff");
  }
  return true; // not an address at all
}

const checked = new Map<string, number>();
const CACHE_MS = 5 * 60_000;

/** Throws unless the host resolves only to public addresses. */
export async function assertPublicHost(hostname: string): Promise<void> {
  if (privateHostsAllowed()) return;
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if ((checked.get(host) ?? 0) > Date.now()) return;
  const refuse = () => new AdapterError("VALIDATION", "This store address points to a private or internal network, which isn't allowed. Use the store's public address.");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw refuse();
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      throw new AdapterError("UNAVAILABLE", `Could not find ${host}. Check the store's address.`);
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw refuse();
  checked.set(host, Date.now() + CACHE_MS);
}

/** Store requests never follow redirects: a public address must not lead somewhere internal. */
export function redirectError(res: Response): AdapterError | null {
  if (res.status < 300 || res.status >= 400) return null;
  const location = res.headers.get("location");
  return new AdapterError("VALIDATION", `The store redirected${location ? ` to ${location}` : ""}. Connect it with that address instead.`);
}
