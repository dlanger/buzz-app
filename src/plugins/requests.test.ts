import { describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "./api";
import { createPluginRequests } from "./requests";
import type {
  Catalog,
  ImportPreview,
  PluginImports,
  PluginInfo,
} from "./types";

const AGENT = { pubkey: "a".repeat(64), name: "Builder" };
const COMMIT = "c".repeat(40);
const manifest = (id: string, extra: Partial<PluginManifest> = {}) =>
  ({ id, name: id.toUpperCase(), apiVersion: 1, ...extra }) as PluginManifest;
const plugin = (id: string, extra: Partial<PluginInfo> = {}): PluginInfo => ({
  manifest: manifest(id),
  source: "external",
  enabled: true,
  revision: `${id}-1`,
  previous: null,
  reloadable: false,
  error: null,
  ...extra,
});
const catalog = (...plugins: PluginInfo[]): Catalog => ({
  profile: "test",
  location: "test",
  plugins,
});
const preview = (
  ...candidates: Array<{ path: string; id: string; revision?: string }>
): ImportPreview => ({
  token: "",
  source: "https://example.com/plugins.git",
  commit: COMMIT,
  candidates: candidates.map(({ path, id, revision = `${id}-2` }) => ({
    path,
    manifest: manifest(id, { host: { networkOrigins: ["https://x.test"] } }),
    revision,
  })),
  warnings: [],
});

function harness(
  current: Catalog = catalog(
    plugin("buzz.channels", { source: "bundled", revision: "bundled" }),
    plugin("example.notes", {
      updateSource: {
        repository: "https://example.com/plugins.git",
        reference: "main",
        path: "notes",
      },
    }),
  ),
  checked: ImportPreview | null = preview(
    { path: "notes", id: "example.notes" },
    { path: "tasks", id: "example.tasks" },
  ),
) {
  let shown = current;
  const checkGit = vi.fn<PluginImports["checkGit"]>(async () => checked);
  const change = vi.fn(async () => true);
  const requests = createPluginRequests({
    catalog: () => shown,
    imports: { checkGit } as unknown as PluginImports,
    change,
    error: () => null,
  });
  return {
    requests,
    agent: requests.forAgent(AGENT),
    checkGit,
    change,
    show: (next: Catalog) => {
      shown = next;
    },
  };
}

describe("list", () => {
  it("reports each plugin's state and source", async () => {
    const { agent } = harness();
    expect(await agent.list()).toEqual({
      plugins: [
        {
          id: "buzz.channels",
          name: "BUZZ.CHANNELS",
          enabled: true,
          bundled: true,
          revision: "bundled",
          source: { kind: "bundled" },
        },
        {
          id: "example.notes",
          name: "EXAMPLE.NOTES",
          enabled: true,
          bundled: false,
          revision: "example.notes-1",
          source: {
            kind: "git",
            repository: "https://example.com/plugins.git",
            reference: "main",
          },
        },
      ],
    });
  });

  it("refuses while plugin settings are unreadable", async () => {
    const requests = createPluginRequests({
      catalog: () => undefined,
      imports: undefined,
      change: vi.fn(),
      error: () => null,
    });
    await expect(requests.forAgent(AGENT).list()).rejects.toThrow(
      "Plugin settings are not ready",
    );
  });
});

describe("discover", () => {
  it("lists every candidate without taking the install preview", async () => {
    const { agent, checkGit } = harness();
    expect(await agent.discover("owner/plugins")).toEqual({
      commit: COMMIT,
      candidates: [
        {
          path: "notes",
          id: "example.notes",
          name: "EXAMPLE.NOTES",
          apiVersion: 1,
          host: { networkOrigins: ["https://x.test"] },
          alreadyInstalled: true,
        },
        {
          path: "tasks",
          id: "example.tasks",
          name: "EXAMPLE.TASKS",
          apiVersion: 1,
          host: { networkOrigins: ["https://x.test"] },
          alreadyInstalled: false,
        },
      ],
    });
    expect(checkGit).toHaveBeenCalledWith("owner/plugins", "");
  });

  it("explains a repository with no built plugins", async () => {
    const { agent } = harness(undefined, {
      ...preview(),
      warnings: ["src: no dist/plugin.js"],
    });
    await expect(agent.discover("owner/plugins", "main")).rejects.toThrow(
      "No built plugins found. src: no dist/plugin.js",
    );
  });

  it("needs the desktop app", async () => {
    const requests = createPluginRequests({
      catalog: () => catalog(),
      imports: undefined,
      change: vi.fn(),
      error: () => null,
    });
    await expect(requests.forAgent(AGENT).discover("owner/x")).rejects.toThrow(
      "Plugin installs require the desktop app",
    );
  });
});

describe("disable", () => {
  it("turns an installed plugin off at once", async () => {
    const { agent, change } = harness();
    expect(await agent.disable("example.notes")).toEqual({
      id: "example.notes",
      enabled: false,
    });
    expect(change).toHaveBeenCalledWith("disable", "example.notes");
  });

  it("refuses Channels and unknown plugins", async () => {
    const { agent, change } = harness();
    await expect(agent.disable("buzz.channels")).rejects.toThrow(
      "Channels is required and cannot be disabled",
    );
    await expect(agent.disable("example.missing")).rejects.toThrow(
      "No plugin example.missing is installed",
    );
    expect(change).not.toHaveBeenCalled();
  });

  it("reports a change storage did not confirm", async () => {
    const requests = createPluginRequests({
      catalog: () => catalog(plugin("example.notes")),
      imports: undefined,
      change: vi.fn(async () => false),
      error: () => "Plugin storage is busy",
    });
    await expect(
      requests.forAgent(AGENT).disable("example.notes"),
    ).rejects.toThrow("Plugin storage is busy");
  });
});
