import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEnv, setEnv } from "./env";
import { createWorkspace } from "./workspaceStore";

let root: string;
let workspaceId: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("env", () => {
	it("starts empty and keeps what is set", async () => {
		expect(await readEnv(root, workspaceId)).toEqual({});

		await setEnv(root, workspaceId, "API_TOKEN", "secret");
		await setEnv(root, workspaceId, "REGION", "eu");

		expect(await readEnv(root, workspaceId)).toEqual({ API_TOKEN: "secret", REGION: "eu" });
	});

	it("replaces a key's value, and drops the key when given nothing", async () => {
		await setEnv(root, workspaceId, "API_TOKEN", "secret");
		await setEnv(root, workspaceId, "API_TOKEN", "rotated");

		expect(await readEnv(root, workspaceId)).toEqual({ API_TOKEN: "rotated" });

		await setEnv(root, workspaceId, "API_TOKEN");

		expect(await readEnv(root, workspaceId)).toEqual({});
	});
});
