import { builtinTools } from "./builtin";
import { implementationOf } from "./script";
import { listScriptTools } from "../storage/scriptTools";
import type { ToolImplementation } from "./define";

/** What a name in the composer, or an id in a permission, points at: one tool of either kind. */
export async function toolNamed(root: string, workspaceId: string, named: string): Promise<ToolImplementation> {
	const builtin = builtinTools.find((tool) => tool.id === named || tool.name === named);
	if (builtin !== undefined) return builtin;

	const script = (await listScriptTools(root, workspaceId)).find((tool) => tool.id === named || tool.name === named);
	if (script === undefined) throw new Error(`No tool ${named}`);

	return implementationOf(script);
}
