# AgentOS implementation guide

You are implementing AgentOS, an Electron app fully specified in docs/overview.md. That document is the source of truth for all observable behavior. Read it completely before your first step, and re-read the relevant section before each step. If the doc does not answer a question your implementation needs answered, stop and ask; never decide behavior silently, and never contradict the doc. When we agree to change a behavior, docs/overview.md is updated first, then the code.

## How we work

- One small step at a time. Propose each step before writing code: what you will build, which files you will touch, and how I will test it when you are done. Wait for my go-ahead.
- Every step ends with something I can verify in a few minutes: the app starts, a UI state is visible, or a test passes. End every step with exactly how to test it: the command to run and what I should see.
- After I test, I accept or give corrections. Never start the next step before the previous one is accepted. Never batch ahead.
- Keep diffs reviewable. If a step grows past roughly 200 changed lines, stop and propose a split.

## Full-control rules

- Build only what the current step needs. No speculative abstractions, no helpers for later, no "while I was here" changes.
- The agreed stack is Electron, TypeScript, React, shadcn/ui with Tailwind, and the Claude Agent SDK. Ask before adding any other dependency, even a small one.
- Comments only for non-obvious constraints; prefer clear names.
- Never run destructive commands (deletes outside the project, git push, force operations) without asking.

## Milestones

Propose steps within this arc; splitting a milestone into several steps is expected, and I may reorder:

1. Scaffold: Electron, React, TypeScript, shadcn/ui, the dark theme shell from the Design section, empty sidebar and main pane. Test: the app opens themed.
2. Storage: workspace records with env, JSONL conversation files, write-on-final discipline, crash-recovery scan on startup. Test: unit tests for the entry lifecycle.
3. Workspace UI: create and select workspaces, conversation list, new conversation, archive. Test: create both, see the JSONL file appear.
4. Messages without agents: composer, @-mention parsing resolved to agent ids, entry rendering, copy to clipboard. Test: send messages, inspect the file.
5. Sandbox and built-in file tools as slash commands: user-invoked tool calls with rendered input and output. Test: /write_file creates a file in the sandbox and an entry in the thread.
6. One agent via the Agent SDK: agent config (name, model, systemPrompt), allow-only permissions, TurnStart and TurnEnd entries, the running-turn indicator. Test: a mentioned agent reads a file and replies.
7. Permissions: ask flow with approval UI, deny with denyMessage, pending and canceled states, decidedAt, turn cancel, the one-writer blocking rules. Test: an ask tool prompts; a deny reaches the agent.
8. Mounts, directory sources first: mount and unmount tools, shared symlinks, readOnly, path collision rules. Test: mount a directory, read through it.
9. Git sources: base clone, worktrees, the git tools, branch-before-edit rule, mode rules, ambient credentials. Test: the full branch, commit, push flow.
10. Script tools: editor UI, schemas, env declaration, sandboxed execution, slash invocation. Test: define a tool, run it as user and as agent.
11. Conversations source, then Interface and Design polish. Test: an agent answers a question about another conversation.

## Communication

- Lead with what changed and how to test; keep explanations short and concrete.
- In prose, never use em dashes.
- Report outcomes plainly: if a test fails or something is unverified, say so.
