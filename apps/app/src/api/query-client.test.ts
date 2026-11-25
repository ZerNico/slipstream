import { Forbidden, NotFound, Unauthorized } from "@slipstream/api";
import { describe, expect, it } from "vitest";
import { makeQueryClient, makeUnauthorizedSignal } from "./query-client.ts";

/** A query client whose 401s are counted. */
const setup = () => {
  const signal = makeUnauthorizedSignal();
  let rejected = 0;
  const stop = signal.listen(() => {
    rejected += 1;
  });
  const client = makeQueryClient(signal);
  // No waiting between retries in tests.
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retryDelay: 0 },
  });
  // fetchQuery does not retry unless asked; screens' queries take the default.
  const retry = client.getDefaultOptions().queries?.retry ?? false;
  return { client, retry, stop, rejected: () => rejected };
};

describe("makeQueryClient", () => {
  it("reports a refused token once and does not ask again", async () => {
    const { client, retry, rejected } = setup();
    let calls = 0;
    const result = await client
      .fetchQuery({
        queryKey: ["me"],
        retry,
        queryFn: () => {
          calls += 1;
          return Promise.reject(new Unauthorized());
        },
      })
      .catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Unauthorized);
    expect(calls).toBe(1);
    expect(rejected()).toBe(1);
  });

  it("retries other failures and does not report them", async () => {
    const { client, retry, rejected } = setup();
    let calls = 0;
    await client
      .fetchQuery({
        queryKey: ["recordings"],
        retry,
        queryFn: () => {
          calls += 1;
          return Promise.reject(new NotFound({ entity: "recording", id: "r1" }));
        },
      })
      .catch(() => undefined);
    expect(calls).toBe(3);
    expect(rejected()).toBe(0);
  });

  it("does not ask again for a read only admins may make", async () => {
    const { client, retry, rejected } = setup();
    let calls = 0;
    await client
      .fetchQuery({
        queryKey: ["sources"],
        retry,
        queryFn: () => {
          calls += 1;
          return Promise.reject(new Forbidden());
        },
      })
      .catch(() => undefined);
    expect(calls).toBe(1);
    expect(rejected()).toBe(0);
  });

  it("tells nobody once the profile's listener is gone", async () => {
    const { client, stop, rejected } = setup();
    stop();
    await client
      .fetchQuery({ queryKey: ["me"], queryFn: () => Promise.reject(new Unauthorized()) })
      .catch(() => undefined);
    expect(rejected()).toBe(0);
  });
});
