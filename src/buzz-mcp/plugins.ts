// The plugin tools: an agent in the app reads this device's plugins, and
// asks the person using Buzz to install, update, enable or remove one. Only
// the desktop app has plugins to manage; elsewhere the tools refuse.
import type { BuzzClient } from "./client";
import type { Tool } from "./tools";

const str = { type: "string" } as const;
const tool = (
  name: string,
  description: string,
  properties: Readonly<Record<string, object>>,
  required: readonly string[] = [],
): Tool => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  },
});
const repository = {
  ...str,
  description: "HTTPS or SSH Git URL, or GitHub owner/repo.",
};
const reference = {
  ...str,
  description: "Branch, tag or commit; default: the repository's default.",
};

export const PLUGIN_TOOLS: readonly Tool[] = [
  tool(
    "plugin_list",
    "List this device's plugins: enabled, bundled, revision and source.",
    {},
  ),
  tool(
    "plugin_discover",
    "List the built plugins in a Git repository that plugin_request can install.",
    { repository, reference },
    ["repository"],
  ),
];

const NAMES = new Set(PLUGIN_TOOLS.map((tool) => tool.name));
export const isPluginTool = (name: string) => NAMES.has(name);

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export async function callPluginTool(
  client: BuzzClient,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { plugins } = client;
  if (!plugins)
    throw new Error("Plugin management is unavailable on this host");
  switch (name) {
    case "plugin_list":
      return JSON.stringify(await plugins.list());
    case "plugin_discover": {
      const repository = text(args.repository);
      if (!repository) throw new Error("repository is required");
      return JSON.stringify(
        await plugins.discover(repository, text(args.reference)),
      );
    }
  }
  throw new Error(`No tool ${name}`);
}
