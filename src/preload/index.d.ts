import type { AgentOSApi } from "../shared/api";

declare global {
	interface Window {
		agentOS: AgentOSApi;
	}
}
