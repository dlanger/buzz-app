import { describe, expect, it, vi } from "vitest";
import type { AgentPlugins } from "../plugins/requests";
import type { BuzzClient } from "./client";
import { callSessionTool, sessionTools } from "./session-tools";

const fake = (plugins: Partial<AgentPlugins>) =>
  ({ pubkey: "a", key: "a", plugins }) as unknown as BuzzClient;
const call = (client: BuzzClient, name: string, args = {}) =>
  callSessionTool(client, {}, name, args);

describe("plugin tools", () => {
  it("load on search", () => {
    const listed = sessionTools().filter((tool) =>
      tool.name.startsWith("plugin_"),
    );
    expect(listed.map(({ name, load }) => [name, load])).toEqual([
      ["plugin_list", "search"],
      ["plugin_discover", "search"],
    ]);
  });

  it("refuse on a host without plugins", async () => {
    const client = { pubkey: "a", key: "a" } as unknown as BuzzClient;
    for (const name of ["plugin_list", "plugin_discover"])
      await expect(
        call(client, name, { repository: "owner/x" }),
      ).rejects.toThrow("Plugin management is unavailable on this host");
  });

  it("list the device's plugins", async () => {
    const plugins = { plugins: [{ id: "example", enabled: true }] };
    const client = fake({ list: vi.fn(async () => plugins) as never });
    expect(JSON.parse((await call(client, "plugin_list")) as string)).toEqual(
      plugins,
    );
  });

  it("discover a repository's candidates", async () => {
    const discover = vi.fn(async () => ({ commit: "c", candidates: [] }));
    const client = fake({ discover: discover as never });
    await call(client, "plugin_discover", {
      repository: " owner/x ",
      reference: "main",
    });
    expect(discover).toHaveBeenCalledWith("owner/x", "main");
    await expect(call(client, "plugin_discover")).rejects.toThrow(
      "repository is required",
    );
  });
});
