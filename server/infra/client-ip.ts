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
 * Client IP for per-client limits (rate limiting, connection caps).
 *
 * Order: `cf-connecting-ip`, `true-client-ip` (set by the edge, overwriting
 * client values), then the LEFTMOST X-Forwarded-For entry, then the socket.
 * Render appends its own internal proxy hop on the right of X-Forwarded-For, so
 * the rightmost entry is shared by every client. The leftmost entry is
 * client-controlled and therefore spoofable: callers must not treat it as an
 * identity, only as a best-effort bucket key alongside per-user limits.
 */
export function getClientIp(event: H3Event): string {
  const header = (name: string) => getRequestHeader(event, name)?.trim() || undefined;
  const ip =
    header("cf-connecting-ip") ??
    header("true-client-ip") ??
    (header("x-forwarded-for")?.split(",")[0]?.trim() || undefined) ??
    event.node.req.socket?.remoteAddress;
  return ip ? normalizeIp(ip) : "unknown";
}
