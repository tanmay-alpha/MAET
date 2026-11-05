import { describe, expect, it } from "bun:test";
import { StreamSlots } from "./stream-slots";

describe("StreamSlots", () => {
  it("caps concurrent streams per user and frees a slot on release", () => {
    const slots = new StreamSlots(3);
    const releases = [slots.acquire("u1"), slots.acquire("u1"), slots.acquire("u1")];
    expect(releases.every((release) => release !== null)).toBe(true);
    expect(slots.acquire("u1")).toBeNull();
    expect(slots.acquire("u2")).not.toBeNull();

    releases[0]!();
    expect(slots.acquire("u1")).not.toBeNull();
    expect(slots.acquire("u1")).toBeNull();
  });

  it("ignores repeated releases of the same stream", () => {
    const slots = new StreamSlots(1);
    const release = slots.acquire("u1")!;
    release();
    release();
    expect(slots.acquire("u1")).not.toBeNull();
    expect(slots.acquire("u1")).toBeNull();
  });
});
