# AgentOS

The goal of AgentOS is to offer a unified, purpose-built interface to interact with agents safely.

## Workspace

A workspace is the top-level container and a hard boundary. What it represents is up to the user: a project, one environment of a project, or any other context.

It owns its agents, tools, mount sources, and conversations, and its env holds the credentials and configuration its tools use.

Nothing is shared between workspaces: reusing an agent elsewhere means copying it and its tools, with the agent's permission keys remapped to the copied tools' new ids; built-in tool ids are the same everywhere. An agent can only reach what its workspace binds, never what another workspace binds. The one exception is machine-level: git remote access authenticates with the host's ambient git setup, as described under Mount, and agents run on the host's Claude Code, signed in as that machine is.

```ts
interface Workspace {
	id: string;
	name: string;
	createdAt: string;
	agents: Agent[];
	tools: ScriptTool[];
	env: Record<string, string>;
	sources: MountSource[];
	conversations: Conversation[];
}
```

## Conversation

A conversation is a thread of messages, tool calls, and turn markers between the user and one or more agents of the workspace. The user brings agents in by @-mentioning them, and every agent in the conversation sees the full thread, every entry included. A message can mention several agents: each acts on it in mention order, one at a time, so later agents see the work of earlier ones. Mentioning the same agent again queues it again: every mention is its own turn. Agents act only when mentioned.

A new conversation starts as a draft: it is visible in the interface and nothing about it is recorded. Its first entry is what creates it, a message or a tool call the user invokes, and that entry gives it its title, shortened to fit the list. A draft that never receives one leaves no trace.

Each mentioned agent's activity on a message is a turn: it begins when the agent starts acting and covers everything it does, several messages and several tool calls included, until it has nothing further to do. A turn ends on its own when the agent finishes, and the next mentioned agent's turn begins; a canceled or failed turn ends the whole chain instead, so agents not yet started never act.

While a turn is running the conversation belongs to the acting agent: the user can neither add messages nor invoke slash commands, whether the agent is working or waiting on a pending call. What the user can always do are the exits: decide a pending call by allowing or denying it, cancel a running call, cancel the whole turn, which stops its current call and skips every later-mentioned agent that has not yet started, or archive the conversation. The thread has exactly one writer at any moment: the user between turns, the acting agent during one. A user-invoked tool call occupies the conversation the same way: until it finishes or is canceled, no message can be sent and no turn can start.

A conversation can have a sandbox: its own directory, created the first time a tool or a mount needs it. With no mounts it is plain scratch space where agents can work; mounts attach the workspace's data sources into it. With isolated mounts, conversations run in parallel without interfering with each other.

Conversations are themselves mountable as a data source, and a reader of a mounted thread only ever sees settled facts: it may see that a turn is underway and everything that turn has settled so far, but never an unfinished entry, and what has been recorded never changes.

```ts
interface Conversation {
	id: string;
	title: string;
	createdAt: string;
	archivedAt?: string;
	sandbox?: string;
	mounts: Mount[];
	entries: (Message | ToolCall | TurnStart | TurnEnd)[];
}
```

## Message

A message is a single contribution to the conversation and comes in two kinds. An agent message carries agentId, so a thread with multiple agents stays attributable. A user message carries mentions, the ids of the @-mentioned agents in mention order: the @names in the content are presentation, and the ids are resolved when the message is sent, so renaming an agent never changes history. A user message without mentions is allowed: it adds to the thread and triggers no turns, and an @name matching no agent of the workspace is ordinary text that resolves to nothing.

Every entry in a conversation names its kind in a type field, which is how the entry kinds are told apart. Tool activity is never embedded in a message: tool calls are their own entries.

```ts
type Message = UserMessage | AgentMessage;

interface UserMessage {
	type: "userMessage";
	id: string;
	mentions?: string[];
	content: string;
	createdAt: string;
}

interface AgentMessage {
	type: "agentMessage";
	id: string;
	agentId: string;
	turnId: string;
	content: string;
	createdAt: string;
}
```

## ToolCall

A tool call is one action performed through a tool, by an agent or by the user invoking the tool directly as a slash command, recorded as its own entry in the conversation. It captures the reason the agent gives for the call, the full input, and the output; because the output follows the tool's outputSchema, it can be rendered natively instead of as text.

The reason is asked of the agent as part of calling: every tool an agent sees takes a required reason argument beside the arguments its inputSchema defines, one short sentence saying why it is making this call. It lands in reason and never in input, so the input stays exactly what the tool received.

A call on an ask tool starts as pending until the user decides; allowed calls start as running and end as success or error, with failures kept in error rather than output. A denied call never runs: its status becomes denied, and the agent receives a standard denial notice, extended with the denyMessage when the user gives one. A running call can be canceled by the user: the work behind it is stopped and its status becomes canceled; when an agent made the call, it receives a cancellation notice and continues its turn, unless the user canceled the whole turn with it. A pending call can also end canceled, when its turn is canceled or the conversation is archived; cancellation sets completedAt but never decidedAt, which is reserved for allow and deny.

The decision itself is part of the record: decidedAt is set the moment the user allows or denies a pending call, so an approved ask call stays distinguishable from a call that ran on a standing allow. Because permissions are invisible to the agent, a pending call looks to it like a call that is still running.

A user-invoked call carries no agentId, no turnId, and no reason, and permissions do not apply to it: the user is the authority permissions exist to protect. Since tool calls stay in the thread, any agent joining later sees exactly what was done, including what the user ran themselves.

```ts
interface ToolCall {
	type: "toolCall";
	id: string;
	agentId?: string;
	turnId?: string;
	toolId: string;
	reason?: string;
	input: Record<string, unknown>;
	output?: Record<string, unknown>;
	error?: string;
	denyMessage?: string;
	status: "pending" | "running" | "success" | "error" | "denied" | "canceled";
	createdAt: string;
	decidedAt?: string;
	completedAt?: string;
}
```

## Turn

A turn is bracketed by two entries. Its start appears the moment a mentioned agent begins acting, so the thread shows the agent at work before its first message or tool call arrives; the agent's messages and tool calls carry the turnId of that start, and user-invoked tool calls belong to no turn. A turn whose start has no end yet is running.

The end closes it: finished when the agent has nothing further to do, failed when its model or network errors, with the error recorded, or canceled when the user stops it. Failed and canceled turns end the mention chain, and everything produced before the end stays in the thread, so a stopped turn is never mistaken for a finished one.

A crash cannot strand the thread: a start without an end is either running right now or interrupted, and on restart AgentOS appends the failed end for the interrupted turn, with its error noting the interruption: Interrupted by an AgentOS restart. A call in flight at the crash was never persisted and never reaches the thread: the failed end is the whole record, consistent with a thread that only ever contains settled facts.

```ts
interface TurnStart {
	type: "turnStart";
	id: string;
	agentId: string;
	createdAt: string;
}

interface TurnEnd {
	type: "turnEnd";
	id: string;
	turnId: string;
	status: "finished" | "failed" | "canceled";
	error?: string;
	createdAt: string;
}
```

## Agent

An agent is a configured actor in the workspace: a name, the model it runs on, a system prompt that defines its behavior, and per-tool permissions.

Each tool the agent may use is listed by tool id with a permission: allow runs the call directly, ask requires user approval, deny hides the tool entirely. Unlisted tools are denied. The agent never sees its permissions: an ask tool looks identical to an allow tool, and a denied tool does not exist for it.

```ts
interface Agent {
	id: string;
	name: string;
	createdAt: string;
	model: string;
	systemPrompt: string;
	tools: Record<string, "allow" | "ask" | "deny">;
}
```

## Tool

A tool is one narrowly scoped capability, never a broad escape hatch like a raw shell, and comes in two kinds.

Built-in tools ship with AgentOS and exist in every workspace: file tools for reading, writing, editing, moving, deleting, listing, and searching in the conversation's sandbox, git tools for branching, committing, pulling, and pushing, and mount tools for attaching and detaching data sources, all respecting read-only mounts. A git tool call names the mount it targets by its sandbox path, since several repositories can be mounted at once.

Script tools are defined by the user in the app, with no AgentOS release needed, so every installation carries its own. A script tool is a JavaScript function: it receives an input object that conforms to inputSchema, plus an env object holding only the workspace env keys the tool declares, and returns an output object that must conform to outputSchema. When the function spawns a command, input values are passed as arguments and never interpolated into a shell string.

Confinement differs by kind: built-in tools enforce it, resolving every path against the sandbox and checking read-only mounts, while a script tool is trusted code with no operating system boundary around the function or what it spawns. AgentOS enforces everything around a script tool's call instead: it starts in the sandbox as its working directory, sees only the declared env, and receives only schema-valid input; guarding against hostile argument values, like a path leading outside the sandbox, is the tool author's responsibility, since arguments are chosen by the agent.

A script tool is named in one word, uniquely in its workspace and never a name a built-in already uses, since naming a tool is how both the composer and an agent call it.

For both kinds, inputSchema tells the agent how to call the tool and outputSchema gives every result a known shape that can be rendered natively. Everything else in the workspace env is invisible to a tool, so a tool's credential access is exactly its declaration. Stable ids keep permissions and past calls pointing at the exact tool.

```ts
type Tool = BuiltinTool | ScriptTool;

interface BuiltinTool {
	type: "builtin";
	id: string;
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	outputSchema: Record<string, unknown>;
}

interface ScriptTool {
	type: "script";
	id: string;
	name: string;
	createdAt: string;
	description: string;
	code: string;
	env: string[];
	inputSchema: Record<string, unknown>;
	outputSchema: Record<string, unknown>;
}
```

## Mount

A mount attaches a data source from the workspace into a conversation's sandbox, at the given path. An isolated mount gives the conversation its own checkout, so parallel conversations never conflict; a shared mount points at one checkout common to all conversations of the workspace. Isolated mounts require a git source.

Mounting is itself a built-in tool call: the user invokes it as a slash command, an agent needs the permission like for any other tool, and every mount and unmount therefore appears in the thread. Mounts can be added and removed for as long as the conversation lives. Unmounting removes the mount from the sandbox: for directory and shared mounts the symlink is deleted and the data behind it is untouched, while an isolated mount's worktree is discarded, exactly as archiving the conversation would. Mount paths must not collide: no two mounts may share a path or nest inside one another. A conversation's mounts list is current state, not history: unmounting removes its entry, and the durable record of every mount and unmount is the pair of tool calls in the thread. Mount permission is per-tool like any other, even though sources differ in sensitivity: the intended guard is granting mount as ask, since a pending mount shows exactly which source, mode, and path the agent wants.

A read-only mount lets agents read the data without changing it, with the same two tiers as sandbox confinement: built-in tools enforce the restriction, script tools are trusted to honor it. A writable shared mount deliberately gives up isolation: every conversation sees and changes the same state, which is the point of choosing it.

Work leaves an isolated mount the ordinary git way, by committing and pushing its branch through tools; archiving a conversation removes its sandbox and its checkouts, so work that was never pushed is gone with it.

How a mount materializes depends on the source. A directory mount is a symlink to the directory itself: nothing is copied, what an agent writes appears in the real directory at once, and outside changes appear in every conversation that mounts it. That is also why directory sources are always shared: a plain directory has no branching to build isolation from. Mounting a directory that is not there is refused, since a link to a missing target fails nowhere near the mistake, at the first read instead. readOnly is enforced by the built-in tools and honored on trust by script tools.

A conversations mount materializes like a directory mount: a symlink, pointing at the workspace's folder of thread files. Its mode and readOnly are not choices but constraints: the mount tool forces shared and read-only for this source type and rejects anything else, just as it rejects isolated mode for any non-git source.

For a git source the workspace keeps one base clone, and both modes derive from it. A shared git mount is a symlink to that clone's working tree, which stays on the source's default branch: every conversation that mounts it works on the same state, in place. Cloning, pulling, and pushing authenticate with the machine's ambient git setup, its SSH keys and git config, exactly as git normally would on that host: git credentials are per machine by design, not per workspace, and never pass through the workspace env. What stays per workspace is which remotes exist at all, since mount sources are workspace-owned.

An isolated git mount is its own worktree added from the base clone, starting at the tip of the default branch, so it sees the same content as everyone else while staying fully separate from other conversations. From there, branching, committing, pulling, and pushing happen through the built-in git tools: branch names follow whatever convention the project uses, and every git action becomes a recorded tool call in the thread. Until a branch is created, an isolated mount is treated as read-only and the editing tools refuse to change it, so work can never begin on the default branch itself. Archiving the conversation removes the worktree and any branches created from it, which is why only pushed work survives.

Mode decides which git tools apply. The inspection tools, git_status, git_diff, and git_log, work on any git mount, and git_pull on any writable one. git_create_branch exists only for isolated mounts: the shared checkout never leaves the default branch, so on a writable shared mount git_commit and git_push operate directly on it, which is exactly what choosing shared means. On a read-only mount the mutating git tools are unavailable. git_push sets a new branch's upstream on its first push; until then, git_pull on that branch fails with a clear error.

```ts
interface Mount {
	sourceId: string;
	path: string;
	mode: "isolated" | "shared";
	readOnly: boolean;
	createdAt: string;
}
```

## MountSource

A mount source is a data location the workspace makes available for mounting: a git repository, a plain directory, or the workspace's own conversations. Its config holds the per-type details, such as the remote and default branch of a repository, or the path of a directory. Sources define what can be mounted; conversations decide what they actually mount. A source is named uniquely within its workspace, since a mount asks for the source by name: creating one under a name already taken is refused.

The conversations source exists because conversations are files: mounting it gives read-only access to the workspace's thread files, archived ones included, so an agent can be asked about anything that ever happened in the workspace. It is always shared, always read-only, and always the workspace's own conversations, so the workspace boundary holds.

```ts
interface MountSource {
	id: string;
	name: string;
	createdAt: string;
	type: "git" | "directory" | "conversations";
	config: Record<string, unknown>;
}
```

## Archiving

Nothing in AgentOS is deleted, and only conversations archive. Archiving a conversation closes it for good: there is no unarchive, its thread stays readable forever, and its sandbox and checkouts are removed, so work that was never pushed is gone. Archiving is available at any moment, blocked or not: it cancels whatever call is pending or running, exactly as if the user had canceled the turn, and those entries keep their canceled status in the closed thread.

Everything else, workspaces, agents, tools, and mount sources, simply persists; since records never disappear, history always stays renderable. That these accumulate in pickers and lists over time is accepted: AgentOS chooses a simple lifecycle over retirement machinery.

## Auditability

Every record carries createdAt; tool calls record decidedAt when the user rules on a pending call and completedAt when they reach a terminal status, a turn's timing is carried by its start and end entries, and a conversation's archiving is recorded as archivedAt rather than a flag, so closing it is itself an audited event.

Built-in tools carry no timestamps: they are part of the app, not records. All timestamps are ISO 8601. Together with append-only conversations and the archive-only lifecycle, every action in AgentOS is traceable to a moment in time.

The scope is deliberately actions, not definitions. Agent prompts, permissions, and script tool code are edited in place without version history: a past entry tells you exactly what happened and when, while the agent or tool it points at is whatever that definition is today.

## Built-in tools

Built-in tools act on the conversation's sandbox and respect read-only mounts; the git remote tools reach exactly as far as the mount's remote, and the mount tools reshape the sandbox itself. The git tools name the mount they target by its sandbox path. There is deliberately no general command runner: running anything is authorized per command, by defining a script tool for it.

- read_file: read a file
- write_file: create a file
- edit_file: change a file by replacing a snippet that must appear exactly once
- move_file: move or rename a file, refusing to overwrite what is already there
- delete_file: remove a file, never a directory
- list_files: list files under a path
- search_files: search file contents by pattern, returning at most a hundred matches
- mount: attach a workspace mount source into the sandbox at a path
- unmount: detach a mount, discarding an isolated mount's worktree
- git_status: show what changed on a git mount
- git_diff: show a git mount's changes
- git_log: show recent history of a git mount's branch
- git_create_branch: create a branch on a git mount and switch the mount onto it
- git_commit: commit changes on a git mount
- git_pull: pull a git mount's branch from the remote
- git_push: push a git mount's branch to the remote

## Interface

Features of the app around the model above.

- Messages and tool calls offer copy to clipboard: a message copies its text, a tool call its input and output as JSON. Turn entries have nothing to copy.
- Agents run on the Claude Code installed on the machine, found wherever it put itself. When it is not there the app says so and where to get it, rather than letting every turn fail on its own.
- An agent's message is rendered as markdown, which is how models write. A user's message stays as typed, with its @mentions highlighted. A link opens in the browser rather than in AgentOS.
- A pending call is decided in the entry itself: approve it, or deny it with a message for the agent alongside.
- The composer is one box with its send button inside it. While a turn runs the composer sends nothing, and that button becomes a stop that cancels the turn.
- The composer completes what can be named in it: / at the start of a message lists the tools, the arguments of that tool once it is named, and @ anywhere lists the agents, all narrowing to what is typed so far. Up and down move through the list, Enter or Tab accepts the highlighted name, and Escape closes the list without accepting. Enter sends only when no list is open.
- The window carries no application menu: everything AgentOS does is reachable in the interface itself.
- The sidebar header holds the workspace picker: it names the workspace in view and switches to any other.
- The window is three panes: the sidebar with the workspace picker and the conversation list, the thread in the middle, and the conversation's mounts, sandbox and agents on the right.
- Conversations, agents, script tools, mount sources and env each open in a pane that replaces the thread.
- A tool is invoked in the composer as a slash command with key=value arguments, quoting any value that contains spaces: /write_file path=notes/todo.md content="Ship it". Invoking one in a draft creates the conversation, exactly as sending a message does, and the call is its first entry.
- The sidebar lists the twenty conversations with the most recent activity, archived ones left out; a conversation's activity is the time of its last entry. The conversations pane lists every conversation, archived included, in that same order.

## Design

A neutral dark theme: near-black background, elevation expressed as slightly lighter shades for surfaces like the sidebar, and white text. Color is minimal and always semantic: green for approve and success, red for deny and errors, amber for pending, and monochrome for everything else. Color appears as border and text rather than filled surfaces, so an approve button is green text in a green border on the dark background.

## Implementation

The stack, for orientation; the sections above define behavior, this section never does.

- An Electron app, TypeScript throughout; the UI is React with shadcn/ui components. Everything runs and is stored locally, which is why each machine carries its own workspaces and tools.
- Agents run on the Claude Agent SDK: a turn is a query() run with the agent's model and systemPrompt, tools are exposed through an in-process MCP server built with tool() and createSdkMcpServer(), every granted tool is passed as allowedTools so the SDK never rules on a call itself, and each tool records its own call into the thread and waits there for the user when it asks. The SDK's own tools are switched off, so an agent has nothing but what the workspace grants it.
- Script tool functions execute in Node with the sandbox as their working directory.
- Conversations are JSONL files, one entry per line, written only once an entry is final: messages when sent, turn starts and ends the moment they happen, tool calls when they reach a terminal status. Lines are immutable and land in write order, with createdAt carrying thread order and file order breaking ties. Mounts are symlinks and git worktrees, as described under Mount.
