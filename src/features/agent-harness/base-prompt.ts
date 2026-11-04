// The Buzz base prompt every agent harness plugin gives its agents, before
// its own instructions, and what a turn a mention or DM starts adds to it.
import basePrompt from "./base_prompt.md?raw";
import mentionPrompt from "./mention_prompt.md?raw";

export const BASE_PROMPT = basePrompt.trim();

/** Shown with each turn a mention or DM starts, and with each message that
 * arrives while one runs: what the agent owes it. Watch, timer and wake
 * turns do not get it; their own sections say what to publish. */
export const MENTION_PROMPT = `<mention>\n${mentionPrompt.trim()}\n</mention>`;
