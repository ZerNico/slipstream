import { describe, expect, it } from "vitest";
import { removeServer, serverFromService, upsertServer } from "./discovery.ts";

const service = {
  name: "unraid",
  host: "unraid.local.",
  port: 8080,
  ipv4: ["192.168.12.11"],
  txt: {},
};

describe("serverFromService", () => {
  it("connects by IPv4 address and port", () => {
    expect(serverFromService(service)).toEqual({
      name: "unraid",
      url: "http://192.168.12.11:8080",
      address: "192.168.12.11",
    });
  });

  it("falls back to the host name and honours a base path", () => {
    expect(serverFromService({ ...service, ipv4: [], txt: { path: "/tv" } })).toEqual({
      name: "unraid",
      url: "http://unraid.local:8080/tv",
      address: "unraid.local",
    });
  });

  it("prefers the advertised public URL", () => {
    const found = serverFromService({ ...service, txt: { url: "https://tv.example.org/" } });
    expect(found?.url).toBe("https://tv.example.org");
    expect(found?.address).toBe("192.168.12.11");
  });

  it("skips services it cannot connect to", () => {
    expect(serverFromService({ ...service, ipv4: [], host: "" })).toBeUndefined();
    expect(serverFromService({ ...service, port: 0 })).toBeUndefined();
  });
});

describe("server list", () => {
  it("updates by name, sorts, and removes", () => {
    const a = { name: "b-box", url: "http://b", address: "b" };
    const b = { name: "a-box", url: "http://a", address: "a" };
    let list = upsertServer(upsertServer([], a), b);
    expect(list.map((server) => server.name)).toEqual(["a-box", "b-box"]);
    list = upsertServer(list, { ...a, url: "http://b2" });
    expect(list.find((server) => server.name === "b-box")?.url).toBe("http://b2");
    expect(removeServer(list, "a-box").map((server) => server.name)).toEqual(["b-box"]);
  });
});
