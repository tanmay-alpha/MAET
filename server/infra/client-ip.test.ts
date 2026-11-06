import { describe, expect, it } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createEvent } from "h3";
import { getClientIp, normalizeIp } from "./client-ip";

function eventWith(headers: Record<string, string>, remoteAddress?: string) {
  // Minimal node request: getClientIp only reads headers and the socket address.
  const req = { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
  return createEvent(req, {} as ServerResponse);
}

describe("getClientIp", () => {
  it("prefers cf-connecting-ip, then true-client-ip, over X-Forwarded-For", () => {
    const xff = { "x-forwarded-for": "198.51.100.7, 10.1.1.1" };
    expect(getClientIp(eventWith({ ...xff, "cf-connecting-ip": "203.0.113.1", "true-client-ip": "203.0.113.2" }))).toBe(
      "203.0.113.1"
    );
    expect(getClientIp(eventWith({ ...xff, "true-client-ip": "203.0.113.2" }))).toBe("203.0.113.2");
    expect(getClientIp(eventWith({ ...xff, "cf-connecting-ip": "  ", "true-client-ip": "203.0.113.2" }))).toBe(
      "203.0.113.2"
    );
  });

  it("falls back to the leftmost X-Forwarded-For entry, never Render's appended proxy hop", () => {
    expect(getClientIp(eventWith({ "x-forwarded-for": "198.51.100.7, 10.1.1.1, 10.2.2.2" }, "10.9.9.9"))).toBe(
      "198.51.100.7"
    );
  });

  it("falls back to the socket address, then 'unknown'", () => {
    expect(getClientIp(eventWith({}, "::ffff:192.0.2.9"))).toBe("192.0.2.9");
    expect(getClientIp(eventWith({}))).toBe("unknown");
  });

  it("normalises IPv6 clients to their /64", () => {
    expect(getClientIp(eventWith({ "cf-connecting-ip": "2001:db8:abcd:12:1::5" }))).toBe("2001:db8:abcd:12::/64");
    expect(getClientIp(eventWith({ "x-forwarded-for": "[2001:db8:abcd:12::9], 10.1.1.1" }))).toBe(
      "2001:db8:abcd:12::/64"
    );
  });
});

describe("normalizeIp", () => {
  it("collapses IPv6 to /64 and unwraps IPv4-mapped addresses", () => {
    expect(normalizeIp("2001:DB8:ABCD:0012:ffff:0:0:1")).toBe("2001:db8:abcd:12::/64");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(normalizeIp("::1")).toBe("0:0:0:0::/64");
    expect(normalizeIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(normalizeIp(" 192.0.2.1 ")).toBe("192.0.2.1");
  });
});
