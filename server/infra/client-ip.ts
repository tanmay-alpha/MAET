import { getRequestHeader, type H3Event } from "h3";

/**
 * Canonical key for a client address: IPv4 as-is (IPv4-mapped IPv6 unwrapped,
 * any port dropped), IPv6 collapsed to its /64 because a single subscriber
 * typically owns a whole /64 and could otherwise rotate addresses freely.
 */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    ip = ip.slice(1, end === -1 ? undefined : end);
  }
  const ipv4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/u.exec(ip);
  if (ipv4) return ipv4[1];
  if (!ip.includes(":")) return ip;

  const [head, tail] = ip.split("%")[0].split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0"), ...tailGroups];
  const prefix = groups.slice(0, 4).map((group) => (Number.parseInt(group, 16) || 0).toString(16));
  while (prefix.length < 4) prefix.push("0");
  return `${prefix.join(":")}::/64`;
}

/**
 * Proxies in front of this server that each append one X-Forwarded-For entry
 * (`TRUSTED_PROXY_HOPS`, default 0: X-Forwarded-For is ignored).
 */
const TRUSTED_PROXY_HOPS = Math.max(0, Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "0", 10) || 0);

/**
 * Client IP for per-client limits (rate limiting, connection caps).
 *
 * Order: `cf-connecting-ip`, then `true-client-ip`, then the X-Forwarded-For
 * entry appended by the outermost of `trustedProxyHops` trusted proxies, then
 * the socket. On Render, Cloudflare fronts every service, overwrites both
 * headers with the address it accepted the connection from, and its chain is
 * `<client>, <Cloudflare edge>, <Render proxy>`: anything a client sends lands
 * to the left of those entries. A client-supplied (leftmost) X-Forwarded-For
 * value is therefore never used; with fewer entries than trusted hops the
 * chain is not the expected one and the socket address is used instead.
 */
export function getClientIp(event: H3Event, trustedProxyHops = TRUSTED_PROXY_HOPS): string {
  const header = (name: string) => getRequestHeader(event, name)?.trim() || undefined;
  const forwarded = trustedProxyHops > 0 ? header("x-forwarded-for")?.split(",") : undefined;
  const ip =
    header("cf-connecting-ip") ??
    header("true-client-ip") ??
    (forwarded && forwarded.length >= trustedProxyHops ? forwarded[forwarded.length - trustedProxyHops].trim() || undefined : undefined) ??
    event.node.req.socket?.remoteAddress;
  return ip ? normalizeIp(ip) : "unknown";
}
