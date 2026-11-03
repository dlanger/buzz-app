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

export type PluginRequestAction = "install";
/** A change an agent asked for, waiting for the person using Buzz. */
export type PluginRequest = Readonly<{
  id: string;
  requester: Readonly<{ pubkey: string; name: string }>;
  action: PluginRequestAction;
  pluginId: string;
  pluginName: string;
  /** What install reviews: the commit the agent saw, so the code the owner
   * confirms cannot change after the request. */
  source?: Readonly<{
    repository: string;
    reference: string;
    path: string;
    commit: string;
  }>;
  /** The agent's own words, shown to the owner as plain text. */
  reason: string;
}>;
export type PluginRequestInput = Readonly<{
  action: PluginRequestAction;
  id?: string | undefined;
  repository?: string | undefined;
  reference?: string | undefined;
  path?: string | undefined;
  commit?: string | undefined;
  reason: string;
}>;
type Decision = "approved" | "declined";

/** As agent creation drafts are: few, and only until the app restarts. */
const PENDING_MAX = 16;
/** Decisions an agent can still read back. */
const SETTLED_MAX = 64;
const REASON_MAX = 500;

/** The plugin operations one agent's tools reach, bound to that agent. */
export type AgentPlugins = ReturnType<
  ReturnType<typeof createPluginRequests>["forAgent"]
>;

export function createPluginRequests({
  catalog,
  imports,
  change,
  error,
}: Readonly<{
  /** The current catalog; undefined while settings load or need recovery. */
  catalog(): Catalog | undefined;
  imports: PluginImports | undefined;
  change(action: ManagementAction, id: string): Promise<boolean>;
  /** The last management error, after `change` returns false. */
  error(): string | null;
}>) {
  let pending: readonly PluginRequest[] = [];
  const settled = new Map<string, PluginRequest & { state: Decision }>();
  const listeners = new Set<() => void>();
  const log = (request: PluginRequest, state: string) =>
    console.info("plugin_request", {
      id: request.id,
      action: request.action,
      pluginId: request.pluginId,
      requester: request.requester.pubkey,
      state,
    });
  const plugins = () => {
    const current = catalog();
    if (!current)
      throw new Error("Plugin settings are not ready. Try again shortly.");
    return current.plugins;
  };
  const installed = (id: string) => {
    const plugin = plugins().find((item) => item.manifest.id === id);
    if (!plugin) throw new Error(`No plugin ${id} is installed`);
    return plugin;
  };
  async function apply(action: ManagementAction, id: string) {
    if (!(await change(action, id)))
      throw new Error(error() ?? "Plugin settings are busy. Try again.");
  }
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
  async function install(input: PluginRequestInput) {
    if (!input.repository) throw new Error("repository is required to install");
    const reference = input.reference ?? "";
    const preview = await check(input.repository, reference);
    const commit = preview.commit?.toLowerCase();
    if (!commit) throw new Error("The repository did not report a commit");
    if (input.commit && input.commit.toLowerCase() !== commit)
      throw new Error(`The repository is at ${commit}, not ${input.commit}`);
    const paths = preview.candidates.map((item) => item.path).join(", ");
    const candidate = input.path
      ? preview.candidates.find((item) => item.path === input.path)
      : preview.candidates.length === 1
        ? preview.candidates[0]
        : undefined;
    if (!candidate)
      throw new Error(
        input.path
          ? `No built plugin at ${input.path}. Found: ${paths}`
          : `Choose a path: ${paths}`,
      );
    const { id, name } = candidate.manifest;
    if (input.id && input.id !== id)
      throw new Error(
        `The plugin at ${candidate.path} is ${id}, not ${input.id}`,
      );
    const existing = plugins().find((item) => item.manifest.id === id);
    if (existing?.source === "bundled")
      throw new Error("That plugin id is reserved");
    if (existing)
      throw new Error(`${id} is already installed; request an update`);
    return {
      pluginId: id,
      pluginName: name,
      source: {
        repository: input.repository,
        reference,
        path: candidate.path,
        commit,
      },
    };
  }

  function forAgent(requester: PluginRequester) {
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
      // Disabling stops code and is undone by an enable request, so it needs
      // no review.
      async disable(id: string) {
        installed(id);
        if (id === "buzz.channels")
          throw new Error("Channels is required and cannot be disabled");
        await apply("disable", id);
        console.info("plugin_disable", {
          pluginId: id,
          requester: requester.pubkey,
        });
        return { id, enabled: false as const };
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
      async request(input: PluginRequestInput) {
        const reason = input.reason.trim();
        if (!reason) throw new Error("reason is required");
        if (reason.length > REASON_MAX)
          throw new Error(`reason must be at most ${REASON_MAX} characters`);
        const target = await install(input);
        // Checked after reading the repository, which takes a while.
        if (requester.live && !requester.live())
          throw new Error("The requesting agent is no longer available");
        if (pending.some((item) => item.pluginId === target.pluginId))
          throw new Error(
            `A request for ${target.pluginId} is already pending`,
          );
        if (pending.length >= PENDING_MAX)
          throw new Error("Review the pending plugin requests first");
        const request: PluginRequest = {
          id: crypto.randomUUID(),
          requester: { pubkey: requester.pubkey, name: requester.name },
          action: input.action,
          ...target,
          reason,
        };
        pending = [...pending, request];
        log(request, "pending");
        notify();
        return { requestId: request.id, applied: false as const };
      },
      status(requestId: string) {
        const request =
          pending.find((item) => item.id === requestId) ??
          settled.get(requestId);
        // Unknown ids include every request from before the app restarted.
        if (request?.requester.pubkey !== requester.pubkey)
          return { state: "expired" as const };
        return {
          state: "state" in request ? request.state : ("pending" as const),
          action: request.action,
          pluginId: request.pluginId,
        };
      },
    };
  }
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    forAgent,
    /** Oldest first, for the owner to review. */
    pending: () => pending,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Records the owner's decision once the reviewed change is applied, or
     * refused. */
    settle(id: string, state: Decision) {
      const request = pending.find((item) => item.id === id);
      if (!request) return;
      pending = pending.filter((item) => item !== request);
      settled.set(id, { ...request, state });
      for (const old of settled.keys()) {
        if (settled.size <= SETTLED_MAX) break;
        settled.delete(old);
      }
      log(request, state);
      notify();
    },
  };
}
