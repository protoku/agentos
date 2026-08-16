import { spawn } from "node:child_process";
import { zodObjectFrom } from "./schema";
import { loadWorkspace } from "../storage/workspaceStore";
import type { ToolImplementation, ToolTarget } from "./define";
import type { ScriptTool } from "../../shared/types";

/**
 * The function itself, run in Node: it is trusted code with no boundary around it or what it
 * spawns. What AgentOS holds is everything around the call, which is this file: schema-valid
 * input, only the env keys the tool declares, and the sandbox as the working directory.
 */
const runner = `
let payload = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { payload += chunk; });
process.stdin.on("end", async () => {
	const { code, input, env } = JSON.parse(payload);
	try {
		const call = new Function("input", "env", "require", "return (async () => {" + code + "})()");
		process.stdout.write(JSON.stringify({ output: await call(input, env, require) }));
	} catch (failure) {
		process.stdout.write(JSON.stringify({ failure: String((failure && failure.message) || failure) }));
	}
});
`;

export function implementationOf(tool: ScriptTool): ToolImplementation {
	const input = zodObjectFrom(tool.inputSchema);
	const output = zodObjectFrom(tool.outputSchema);

	return {
		id: tool.id,
		name: tool.name,
		description: tool.description,
		input,
		async run(given, context) {
			const returned = await callScript(
				tool,
				input.parse(given),
				await declaredEnv(tool, context),
				context.sandbox,
				context.signal,
			);

			return output.parse(returned);
		},
	};
}

/** Everything else in the workspace env is invisible: a tool's reach is exactly its declaration. */
async function declaredEnv(tool: ScriptTool, context: ToolTarget): Promise<Record<string, string>> {
	const { env } = await loadWorkspace(context.root, context.workspaceId);

	return Object.fromEntries(tool.env.filter((key) => key in env).map((key) => [key, env[key]]));
}

async function callScript(
	tool: ScriptTool,
	input: Record<string, unknown>,
	env: Record<string, string>,
	sandbox: string,
	signal: AbortSignal,
): Promise<unknown> {
	const written = await inNode(JSON.stringify({ code: tool.code, input, env }), sandbox, signal);
	const { output, failure } = JSON.parse(written) as { output?: unknown; failure?: string };

	if (failure !== undefined) throw new Error(failure);

	return output;
}

function inNode(payload: string, cwd: string, signal: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		// ELECTRON_RUN_AS_NODE, since in the app this same binary is Electron rather than node.
		const child = spawn(process.execPath, ["-e", runner], {
			cwd,
			signal,
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
		});

		let written = "";
		let complained = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => (written += chunk));
		child.stderr.on("data", (chunk: string) => (complained += chunk));

		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0 && written.length > 0) return resolve(written);

			reject(new Error(complained.trim().length > 0 ? complained.trim() : `The tool ended with code ${code}`));
		});

		child.stdin.end(payload);
	});
}
