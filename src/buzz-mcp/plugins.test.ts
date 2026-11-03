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
      ["plugin_disable", "search"],
      ["plugin_request", "search"],
      ["plugin_request_status", "search"],
    ]);
  });

  it("refuse on a host without plugins", async () => {
    const client = { pubkey: "a", key: "a" } as unknown as BuzzClient;
    for (const name of [
      "plugin_list",
      "plugin_discover",
      "plugin_disable",
      "plugin_request",
      "plugin_request_status",
    ])
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

  it("disable a plugin by id", async () => {
    const disable = vi.fn(async (id: string) => ({ id, enabled: false }));
    const client = fake({ disable: disable as never });
    expect(
      JSON.parse(
        (await call(client, "plugin_disable", { id: "example" })) as string,
      ),
    ).toEqual({ id: "example", enabled: false });
    await expect(call(client, "plugin_disable")).rejects.toThrow(
      "id is required",
    );
  });

  it("request a change and read its status", async () => {
    const request = vi.fn(async () => ({ requestId: "r", applied: false }));
    const status = vi.fn(() => ({ state: "pending" }));
    const client = fake({ request, status } as never);
    expect(
      JSON.parse(
        (await call(client, "plugin_request", {
          action: "install",
          repository: "owner/x",
          path: "tasks",
          reason: "Track the board",
        })) as string,
      ),
    ).toEqual({ requestId: "r", applied: false });
    expect(request).toHaveBeenCalledWith({
      action: "install",
      id: undefined,
      repository: "owner/x",
      reference: undefined,
      path: "tasks",
      commit: undefined,
      reason: "Track the board",
    });
    await expect(
      call(client, "plugin_request", { action: "explode", reason: "x" }),
    ).rejects.toThrow("action must be one of install");
    expect(
      JSON.parse(
        (await call(client, "plugin_request_status", {
          requestId: "r",
        })) as string,
      ),
    ).toEqual({ state: "pending" });
    expect(status).toHaveBeenCalledWith("r");
  });
});
