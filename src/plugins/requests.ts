// What an agent may do with this device's plugins. Reading is direct; a
// change that starts or deletes plugin code is a request the person using
// Buzz confirms in Settings, since plugins are not sandboxed.
import type { Catalog, ManagementAction, PluginImports } from "./types";

export type PluginRequester = Readonly<{
  pubkey: string;
  name: string;
  /** Whether the agent can still ask; a removed agent's requests are refused. */
  live?(): boolean;
}>;

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Absent where no plugin manager runs. */
    pluginRequests?: PluginRequests;
  }
}
export type PluginRequests = ReturnType<typeof createPluginRequests>;

/** The plugin operations one agent's tools reach, bound to that agent. */
export type AgentPlugins = ReturnType<
  ReturnType<typeof createPluginRequests>["forAgent"]
>;

export function createPluginRequests({
  catalog,
  imports,
}: Readonly<{
  /** The current catalog; undefined while settings load or need recovery. */
  catalog(): Catalog | undefined;
  imports: PluginImports | undefined;
  change(action: ManagementAction, id: string): Promise<boolean>;
  /** The last management error, after `change` returns false. */
  error(): string | null;
}>) {
  const plugins = () => {
    const current = catalog();
    if (!current)
      throw new Error("Plugin settings are not ready. Try again shortly.");
    return current.plugins;
  };
  const gitImports = () => {
    if (!imports) throw new Error("Plugin installs require the desktop app");
    return imports;
  };
  async function check(repository: string, reference: string) {
    const preview = await gitImports().checkGit(repository, reference);
    if (!preview?.candidates.length)
      throw new Error(
        ["No built plugins found.", ...(preview?.warnings ?? [])].join(" "),
      );
    return preview;
  }

  function forAgent(_requester: PluginRequester) {
    return {
      async list() {
        return {
          plugins: plugins().map((plugin) => {
            const source = plugin.updateSource;
            return {
              id: plugin.manifest.id,
              name: plugin.manifest.name,
              enabled: plugin.enabled,
              bundled: plugin.source === "bundled",
              revision: plugin.revision,
              source:
                plugin.source === "bundled"
                  ? { kind: "bundled" as const }
                  : source && "repository" in source
                    ? {
                        kind: "git" as const,
                        repository: source.repository,
                        reference: source.reference,
                        ...(source.commit && { commit: source.commit }),
                      }
                    : { kind: "folder" as const },
            };
          }),
        };
      },
      async discover(repository: string, reference = "") {
        const preview = await check(repository, reference);
        const installed = new Set(plugins().map((item) => item.manifest.id));
        return {
          commit: preview.commit,
          candidates: preview.candidates.map(({ path, manifest }) => ({
            path,
            id: manifest.id,
            name: manifest.name,
            apiVersion: manifest.apiVersion,
            ...(manifest.host && { host: manifest.host }),
            alreadyInstalled: installed.has(manifest.id),
          })),
        };
      },
    };
  }
  return { forAgent };
}
