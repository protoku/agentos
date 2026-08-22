import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { grantedTools, type CallContext } from "./tools";
import { createWorkspace } from "../storage/workspaceStore";
import type { Agent } from "../../shared/types";

let root: string;
let workspaceId: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function context(): CallContext {
	return {
		root,
		workspaceId,
		conversationId: "conversation-1",
		sandbox: join(root, "sandbox"),
		file: join(root, "thread.jsonl"),
		agentId: "agent-1",
		turnId: "turn-1",
		emit: () => {},
		stopped: () => false,
	};
}

function agentWith(tools: Agent["tools"]): Agent {
	return {
		id: "agent-1",
		name: "ops",
		createdAt: "2026-08-15T10:00:00.000Z",
		model: "claude-opus-5",
		systemPrompt: "",
		tools,
		carries: [],
	};
}

describe("grantedTools", () => {
	it("grants what the agent is listed for", async () => {
		const granted = await grantedTools(agentWith({ read_file: "allow", write_file: "ask" }), context());

		expect([...granted.allowedTools].sort()).toEqual(["mcp__agentos__read_file", "mcp__agentos__write_file"]);
	});

	it("keeps a denied tool from the agent, exactly as an unlisted one", async () => {
		const granted = await grantedTools(agentWith({ read_file: "allow", write_file: "deny" }), context());

		expect(granted.allowedTools).toEqual(["mcp__agentos__read_file"]);
	});

	it("grants nothing to an agent listed for nothing", async () => {
		expect((await grantedTools(agentWith({}), context())).allowedTools).toEqual([]);
	});
});
