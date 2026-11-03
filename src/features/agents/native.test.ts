import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";
import { hasEventProof } from "../relay/events";
import { keypair, signed } from "../relay/testing";
import { nativeAgents, unconfirmedAgentEvent } from "./native";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));

const native = nativeAgents();
if (!native) throw new Error("expected native agents under Tauri");
const agent = keypair();
const member = { pubkey: agent.pubkey, relay: "https://relay.example.test" };
const message = signed(agent, { kind: 9, content: "hi", tags: [["h", "c"]] });
const query = (response: unknown) => {
  vi.mocked(invoke).mockResolvedValueOnce(response);
  return native.query(member, [{ kinds: [9] }]);
};

it("reads the signed id from an uncertain native publish outcome", () => {
  const id = "a".repeat(64);
  const uncertain = `Agent event ${id} unconfirmed; it may or may not have been accepted`;
  expect(unconfirmedAgentEvent(new Error(uncertain))).toBe(id);
  expect(unconfirmedAgentEvent(uncertain)).toBe(id);
  expect(
    unconfirmedAgentEvent(
      new Error("The community refused the agent event: blocked"),
    ),
  ).toBeUndefined();
});

it("admits the community's events through the relay verifier", async () => {
  const events = await query([JSON.parse(JSON.stringify(message))]);
  expect(events).toMatchObject([{ id: message.id, content: "hi" }]);
  expect(events.every(hasEventProof)).toBe(true);
  expect(invoke).toHaveBeenCalledWith("app_agent_query", {
    ...member,
    filters: [{ kinds: [9] }],
  });
});

it.each([
  ["a forged signature", [{ ...message, sig: "0".repeat(128) }]],
  ["edited content", [{ ...message, content: "bye" }]],
  ["a malformed record", [{ ...message, tags: "h" }]],
  ["one bad event among good ones", [message, { ...message, kind: 7 }]],
  ["a non-array body", { events: [message] }],
])("rejects %s", async (_, response) => {
  await expect(query(response)).rejects.toThrow(
    /malformed or invalidly signed|not an event array/,
  );
});

it("searches profile names natively and reports a community without the search", async () => {
  const profile = signed(agent, {
    kind: 0,
    content: '{"name":"Wes"}',
    tags: [],
  });
  vi.mocked(invoke).mockResolvedValueOnce([
    JSON.parse(JSON.stringify(profile)),
  ]);
  const found = await native.searchProfiles(member, "wes", 100);
  expect(found).toMatchObject([{ id: profile.id }]);
  expect(found?.every(hasEventProof)).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith("app_agent_search_profiles", {
    ...member,
    query: "wes",
    limit: 100,
  });
  vi.mocked(invoke).mockResolvedValueOnce(null);
  expect(await native.searchProfiles(member, "wes", 100)).toBeUndefined();
  vi.mocked(invoke).mockResolvedValueOnce([
    { ...profile, sig: "0".repeat(128) },
  ]);
  await expect(native.searchProfiles(member, "wes", 100)).rejects.toThrow(
    /malformed or invalidly signed/,
  );
});

it("keeps managed attachment hints out of the signed event and preserves absent-context IPC", async () => {
  vi.mocked(invoke).mockReset().mockResolvedValue(message);
  const template = { kind: 9, content: "attachment", tags: [["h", "c"]] };
  const managedAttachments = [
    {
      path: "/saved/file",
      sha256: "a".repeat(64),
      size: 5,
      url: "https://example.test/media",
    },
  ];
  await native.publish(member, template, { managedAttachments });
  expect(invoke).toHaveBeenLastCalledWith("app_agent_publish", {
    ...member,
    event: template,
    managedAttachments,
  });
  await native.publish(member, template);
  expect(invoke).toHaveBeenLastCalledWith("app_agent_publish", {
    ...member,
    event: template,
  });
});
