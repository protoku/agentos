import { spawn } from "node:child_process";
import { z } from "zod";
import { define, sandboxPath, type BuiltinToolImplementation } from "./define";
import { resolveInSandbox } from "./sandbox";
import { createScriptTool, listScriptTools, updateScriptTool } from "../storage/scriptTools";

const schema = z.record(z.string(), z.unknown());
const declaredEnv = z.array(z.string()).default([]).describe("Workspace env keys the tool may see");
const readable = 4000;

/**
 * The tools for building tools. An agent granted these can define a capability and then use it,
 * which is why they are the largest permission here and why ask is the sensible way to hold them.
 */
export const authoringTools: BuiltinToolImplementation[] = [
	define({
		id: "define_tool",
		description: "Add a script tool to this workspace.",
		input: z.object({
			name: z.string().describe("One word, unique in the workspace, never a built-in's name"),
			description: z.string().describe("What it does, for whoever calls it"),
			code: z.string().describe("The function body, receiving input and env, returning the output object"),
			env: declaredEnv,
			inputSchema: schema,
			outputSchema: schema,
		}),
		outputSchema: {
			type: "object",
			properties: { id: { type: "string" }, name: { type: "string" } },
			required: ["id", "name"],
		},
		async run(draft, context) {
			const tool = await createScriptTool(context.root, context.workspaceId, draft);

			return { id: tool.id, name: tool.name };
		},
	}),
	define({
		id: "update_tool",
		description: "Change a script tool of this workspace, naming it as it is named now.",
		input: z.object({
			name: z.string().describe("The tool to change"),
			description: z.string().optional(),
			code: z.string().optional(),
			env: z.array(z.string()).optional(),
			inputSchema: schema.optional(),
			outputSchema: schema.optional(),
			rename: z.string().optional().describe("A new name, if it should have one"),
		}),
		outputSchema: {
			type: "object",
			properties: { id: { type: "string" }, name: { type: "string" } },
			required: ["id", "name"],
		},
		async run({ name, rename, ...changes }, context) {
			const tools = await listScriptTools(context.root, context.workspaceId);
			const tool = tools.find((candidate) => candidate.name === name);
			if (tool === undefined) throw new Error(`No tool ${name}`);

			const written = Object.fromEntries(
				Object.entries(changes).filter(([, value]) => value !== undefined),
			);
			const updated = await updateScriptTool(context.root, context.workspaceId, {
				...tool,
				...written,
				...(rename !== undefined && { name: rename }),
			});

			return { id: updated.id, name: updated.name };
		},
	}),
	define({
		id: "run_command",
		description: "Run one command in the sandbox, to find out what it does and what it returns.",
		input: z.object({
			command: z.string().describe("The program to run, found on the machine's PATH"),
			args: z.array(z.string()).default([]).describe("Its arguments, one per entry, never a line to split"),
			path: sandboxPath.default(".").describe("Where in the sandbox to run it"),
		}),
		outputSchema: {
			type: "object",
			properties: {
				ok: { type: "boolean" },
				exitCode: { type: "number" },
				output: { type: "string" },
			},
			required: ["ok", "exitCode", "output"],
		},
		async run({ command, args, path }, context) {
			const cwd = resolveInSandbox(context.sandbox, path);

			return new Promise((settle) => {
				// The machine's environment, without the settings AgentOS runs itself under.
				const env = { ...process.env };
				delete env.ELECTRON_RUN_AS_NODE;
				delete env.NODE_ENV;

				const child = spawn(command, args, { cwd, env, signal: context.signal });
				let said = "";

				child.stdout?.setEncoding("utf8");
				child.stderr?.setEncoding("utf8");
				child.stdout?.on("data", (chunk: string) => (said += chunk));
				child.stderr?.on("data", (chunk: string) => (said += chunk));

				child.on("error", (failure) => settle({ ok: false, exitCode: -1, output: failure.message }));
				child.on("close", (code) =>
					settle({ ok: code === 0, exitCode: code ?? -1, output: said.slice(-readable) }),
				);
			});
		},
	}),
];
