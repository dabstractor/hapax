/**
 * PRD §05 ingestion filter suite (P1.M3.T2.S1): extractText maps finalized
 * AgentMessages to ingestable text — user prompt text (string content or text
 * blocks, images silently skipped), assistant text blocks only (thinking and
 * toolCall blocks are not agent output to the user; toolResult/custom roles
 * are ignored). Zero text parts → null (never ""). Purity is verified with
 * deep-frozen inputs: any mutation attempt throws in strict mode.
 */

import { describe, expect, it } from "vitest";
import { extractText, type AgentMessage } from "../src/pi/ingest.js";

// --- fixture helpers: minimal valid pi messages (contextually typed) -------

type UserMessage = Extract<AgentMessage, { role: "user" }>;
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;

const userMsg = (content: UserMessage["content"]): UserMessage => ({
  role: "user",
  content,
  timestamp: 0,
});

const assistantMsg = (
  content: AssistantMessage["content"],
): AssistantMessage => ({
  role: "assistant",
  content,
  api: "anthropic-messages",
  provider: "anthropic",
  model: "test-model",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 0,
});

const toolResultMsg = (): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: "call_1",
  toolName: "read",
  content: [],
  isError: false,
  timestamp: 0,
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as object)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const text = (s: string) => ({ type: "text", text: s }) as const;

describe("extractText — PRD §05 event contract (P1.M3.T2.S1)", () => {
  it("user string content → the string itself", () => {
    expect(extractText(userMsg("fix the state machine"))).toBe(
      "fix the state machine",
    );
  });

  it("user empty string content → \"\" (faithful; pipeline may drop it)", () => {
    expect(extractText(userMsg(""))).toBe("");
  });

  it("user [text, image, text] → texts joined with \\n, images skipped", () => {
    expect(
      extractText(
        userMsg([
          text("first"),
          { type: "image", data: "Zm9v", mimeType: "image/png" },
          text("second"),
        ]),
      ),
    ).toBe("first\nsecond");
  });

  it("user images-only array → null (zero text parts, never \"\")", () => {
    expect(
      extractText(
        userMsg([{ type: "image", data: "Zm9v", mimeType: "image/png" }]),
      ),
    ).toBeNull();
  });

  it("user [] → null (zero text parts)", () => {
    expect(extractText(userMsg([]))).toBeNull();
  });

  it("user parts join with \\n even when a part is the empty string", () => {
    expect(extractText(userMsg([text(""), text("b")]))).toBe("\nb");
  });

  it("assistant [text, thinking, toolCall, text] → texts joined; bodies absent", () => {
    const out = extractText(
      assistantMsg([
        text("answer one"),
        { type: "thinking", thinking: "SECRET-THINKING" },
        {
          type: "toolCall",
          id: "t1",
          name: "read",
          arguments: { path: "SECRET-ARGS" },
        },
        text("answer two"),
      ]),
    );
    expect(out).toBe("answer one\nanswer two");
    expect(out).not.toContain("SECRET-THINKING");
    expect(out).not.toContain("SECRET-ARGS");
  });

  it("assistant thinking+toolCall only → null (never \"\")", () => {
    expect(
      extractText(
        assistantMsg([
          { type: "thinking", thinking: "hmm" },
          { type: "toolCall", id: "t1", name: "read", arguments: {} },
        ]),
      ),
    ).toBeNull();
  });

  it("assistant [] → null (zero text parts)", () => {
    expect(extractText(assistantMsg([]))).toBeNull();
  });

  it("assistant text with markdown code fences → returned verbatim", () => {
    const fenced = "```ts\nconst x = 1;\n```";
    expect(extractText(assistantMsg([text(fenced)]))).toBe(fenced);
  });

  it("toolResult → null (generated-or-ingested content, not fair game)", () => {
    expect(extractText(toolResultMsg())).toBeNull();
  });

  it("custom role (e.g. system) → null, never throws", () => {
    const custom = { role: "system", content: "ignored" } as unknown as AgentMessage;
    expect(extractText(custom)).toBeNull();
  });

  it("purity: deep-frozen messages → no throw, correct output (non-mutation)", () => {
    // Any write to a frozen object throws a TypeError in strict mode (ESM),
    // so completing without throwing proves extractText never mutates input.
    const frozenUser = deepFreeze(userMsg([text("a"), text("b")]));
    expect(extractText(frozenUser)).toBe("a\nb");
    expect(Object.isFrozen(frozenUser)).toBe(true);

    const frozenAssistant = deepFreeze(
      assistantMsg([text("only"), { type: "thinking", thinking: "x" }]),
    );
    expect(extractText(frozenAssistant)).toBe("only");
    expect(Object.isFrozen(frozenAssistant)).toBe(true);
  });
});