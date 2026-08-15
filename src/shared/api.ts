import type { Workspace } from "./types";

export interface AgentOSApi {
	listWorkspaces(): Promise<Workspace[]>;
	createWorkspace(name: string): Promise<Workspace>;
}
