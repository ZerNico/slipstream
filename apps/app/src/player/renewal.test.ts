import { MINUTE, renewalFloorMillis } from "@slipstream/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Renewed, startRenewal } from "./renewal.ts";

const T0 = Date.UTC(2026, 10, 23, 20);

/** A renewal whose server answers are queued by the test. */
const setup = (expiresAt: number) => {
  const answers: (() => Promise<Renewed>)[] = [];
  const renew = vi.fn<() => Promise<Renewed>>(() =>
    (answers.shift() ?? (() => Promise.reject(new Error("offline"))))(),
  );
  const onRenewed = vi.fn<(uri: string) => void>();
  const onFailed = vi.fn<() => void>();
  const renewal = startRenewal({ expiresAt, renew, onRenewed, onFailed });
  const answer = (uri: string, until: number) =>
    answers.push(() => Promise.resolve({ uri, expiresAt: until }));
  const refuse = () => answers.push(() => Promise.reject(new Error("offline")));
  return { renewal, renew, onRenewed, onFailed, answers, answer, refuse };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startRenewal", () => {
  it("renews five minutes before the token expires and repeats from each new expiry", async () => {
    const { renewal, renew, onRenewed, answer } = setup(T0 + 30 * MINUTE);
    answer("/hls/2.m3u8", T0 + 55 * MINUTE);
    answer("/hls/3.m3u8", T0 + 80 * MINUTE);

    await vi.advanceTimersByTimeAsync(25 * MINUTE - 1);
    expect(renew).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(onRenewed).toHaveBeenLastCalledWith("/hls/2.m3u8");

    // Next one five minutes before 55: at 50.
    await vi.advanceTimersByTimeAsync(25 * MINUTE);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(onRenewed).toHaveBeenLastCalledWith("/hls/3.m3u8");
    renewal.stop();
  });

  it("retries a failed renewal after the floor, while the old token may still work", async () => {
    const { renewal, renew, onRenewed, onFailed, refuse, answer } = setup(T0 + 10 * MINUTE);
    refuse();
    answer("/hls/2.m3u8", T0 + 40 * MINUTE);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(onRenewed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(renewalFloorMillis);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(onRenewed).toHaveBeenCalledWith("/hls/2.m3u8");
    expect(onFailed).not.toHaveBeenCalled();
    renewal.stop();
  });

  it("renews right away after a refusal, but only once until playback works again", async () => {
    const { renewal, renew, onRenewed, answer } = setup(T0 + 30 * MINUTE);
    answer("/hls/2.m3u8", T0 + 60 * MINUTE);
    answer("/hls/3.m3u8", T0 + 90 * MINUTE);

    expect(renewal.recover()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(onRenewed).toHaveBeenLastCalledWith("/hls/2.m3u8");

    // Refused again before the new playlist played: no second retry.
    expect(renewal.recover()).toBe(false);
    expect(renew).toHaveBeenCalledTimes(1);

    // Once it plays, a later refusal may renew again.
    renewal.playing();
    expect(renewal.recover()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onRenewed).toHaveBeenLastCalledWith("/hls/3.m3u8");
    renewal.stop();
  });

  it("gives up when the renewal after a refusal fails", async () => {
    const { renewal, onFailed, refuse } = setup(T0 + 30 * MINUTE);
    refuse();
    expect(renewal.recover()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onFailed).toHaveBeenCalledTimes(1);
    renewal.stop();
  });

  it("does nothing once stopped, even for an answer still in flight", async () => {
    const { renewal, renew, onRenewed, answers } = setup(T0 + 6 * MINUTE);
    const pending = Promise.withResolvers<Renewed>();
    answers.push(() => pending.promise);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(renew).toHaveBeenCalledTimes(1);
    renewal.stop();
    pending.resolve({ uri: "/hls/2.m3u8", expiresAt: T0 + 60 * MINUTE });
    await vi.advanceTimersByTimeAsync(0);
    expect(onRenewed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 60 * MINUTE);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(renewal.recover()).toBe(false);
  });
});
