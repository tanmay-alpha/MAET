import { describe, expect, setSystemTime, test, afterEach } from "bun:test";
import { parseAuthFragment } from "./auth-fragment";

/** mulberry32: seeded PRNG, so every run checks the same generated fragments. */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("parseAuthFragment", () => {
  afterEach(() => setSystemTime());

  test("reads the session GoTrue redirects back with after a sign-up confirmation", () => {
    const hash =
      "#access_token=eyJhbGciOi.payload.sig&expires_at=1794000000&expires_in=3600&refresh_token=v1.refresh&token_type=bearer&type=signup";
    expect(parseAuthFragment(hash)).toEqual({
      kind: "session",
      accessToken: "eyJhbGciOi.payload.sig",
      refreshToken: "v1.refresh",
      expiresAt: 1_794_000_000,
      expiresIn: 3600,
      type: "signup",
    });
  });

  test("derives expires_at from expires_in when GoTrue omits it", () => {
    setSystemTime(new Date("2026-11-19T10:00:00.000Z"));
    const parsed = parseAuthFragment("access_token=a&refresh_token=r&expires_in=3600&type=magiclink");
    expect(parsed).toMatchObject({ kind: "session", expiresAt: Date.parse("2026-11-19T11:00:00.000Z") / 1000, type: "magiclink" });
  });

  test("ignores unusable expiry values instead of storing NaN or a past time", () => {
    for (const expiry of ["expires_at=abc", "expires_at=-5", "expires_at=", "expires_in=0", "expires_in=Infinity"]) {
      expect(parseAuthFragment(`#access_token=a&refresh_token=r&${expiry}`)).toMatchObject({ kind: "session", expiresAt: undefined });
    }
  });

  test("decodes percent-encoded and plus-encoded values", () => {
    expect(parseAuthFragment("#access_token=a%2Bb&refresh_token=c+d")).toMatchObject({ accessToken: "a+b", refreshToken: "c d" });
  });

  test("reports an expired or invalid email link with a line saying what to do", () => {
    expect(
      parseAuthFragment("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"),
    ).toEqual({
      kind: "error",
      code: "otp_expired",
      message: "This email link is invalid or has expired. Sign in, or sign up again to get a new link.",
    });
    expect(parseAuthFragment("#error=server_error&error_description=Database+error+saving+new+user")).toEqual({
      kind: "error",
      code: null,
      message: "Database error saving new user",
    });
    expect(parseAuthFragment("#error=access_denied")).toEqual({ kind: "error", code: null, message: "Sign-in link failed (access_denied)." });
  });

  test("an error wins over tokens in the same fragment", () => {
    expect(parseAuthFragment("#access_token=a&refresh_token=r&error=access_denied")?.kind).toBe("error");
  });

  test("a fragment with only one of the two tokens is an error, so it is still stripped", () => {
    expect(parseAuthFragment("#access_token=a")?.kind).toBe("error");
    expect(parseAuthFragment("#refresh_token=r&type=signup")?.kind).toBe("error");
  });

  test("leaves ordinary in-page anchors alone", () => {
    for (const hash of ["", "#", "#scanner", "#paper", "#section=2&tab=chart", "#access_token=&refresh_token="]) {
      expect(parseAuthFragment(hash)).toBeNull();
    }
  });

  test("any fragment that names a token or an error is never left alone", () => {
    const random = prng(1119);
    const keys = ["access_token", "refresh_token", "error", "error_code", "error_description", "expires_in", "type", "tab", "x"];
    const values = ["", "v", "a%20b", "1", "-1", "signup", "&", "="];
    for (let run = 0; run < 3_000; run++) {
      const parts = Array.from({ length: 1 + Math.floor(random() * 5) }, () => {
        const key = keys[Math.floor(random() * keys.length)]!;
        const value = values[Math.floor(random() * values.length)]!;
        return `${key}=${value}`;
      });
      const hash = `#${parts.join("&")}`;
      const params = new URLSearchParams(hash.slice(1));
      const carriesAuth = ["access_token", "refresh_token", "error", "error_code"].some((key) => params.get(key));
      const parsed = parseAuthFragment(hash);
      expect(parsed !== null).toBe(carriesAuth);
      if (parsed?.kind === "session") {
        expect(parsed.accessToken).toBe(params.get("access_token")!);
        expect(parsed.refreshToken).toBe(params.get("refresh_token")!);
      }
    }
  });
});
