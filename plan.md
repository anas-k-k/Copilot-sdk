# Personal Assistant on Copilot SDK via Telegram

## Problem

Build a personal assistant on top of the GitHub Copilot SDK that can be used from Telegram and can leverage installable skills to complete user tasks. The assistant should be able to discover relevant skills from `skill.sh` and install them for the user when appropriate. The current workspace contains a research summary of the Copilot SDK rather than an application codebase, so the plan needs to define the initial project structure, integration points, and delivery sequence for a new app.

## Current State Analysis

- The workspace currently contains `github-copilot-sdk.md`, a research report summarizing the Copilot SDK architecture and capabilities.
- The SDK is a client-to-CLI integration layer: an app talks to a language SDK, the SDK talks JSON-RPC to the Copilot CLI runtime, and the CLI handles agent execution.
- The SDK supports multiple languages, but Node.js/TypeScript appears to be the most straightforward fit for a Telegram bot because the report explicitly references the `@github/copilot-sdk` package and a mature Node packaging flow.
- Important capabilities relevant to a Telegram assistant include:
  - Session-based conversations
  - Tool definitions and permission handling
  - Attachments / blobs
  - System prompt customization
  - Low-level RPC access if needed later
- The request now adds a second major integration surface beyond Telegram: a skill discovery and installation flow tied to `skill.sh`.
- The report does not describe an existing Telegram integration or any app scaffolding in this workspace, so this should be treated as a greenfield implementation.

## Proposed Approach

Create a Telegram bot service that maps each Telegram user or chat to a Copilot SDK session, forwards incoming messages to the assistant, streams or relays responses back to Telegram, and adds an integration layer for bot commands, skill discovery, skill installation, session management, and operational safeguards.

For v1, optimize for a reliable text-first assistant with a controlled skills workflow before adding advanced capabilities like rich attachments, long-term memory stores, or multi-agent workflows.

## Assumptions

- Implementation target is Node.js/TypeScript.
- Initial delivery is a Telegram chat assistant, not a full multi-channel platform.
- v1 focuses on direct chat interactions and basic commands such as reset/help/status.
- v1 includes a skills capability: the assistant can identify when a task would benefit from a skill, search `skill.sh`, and guide or perform installation through an explicit workflow.
- Skill installation always requires explicit user confirmation before anything is installed from `skill.sh`.
- Long-term memory and admin dashboards are out of scope for the first cut unless you want them in v1.

## Implementation Plan

### 1. Bootstrap the service

- Initialize a Node.js/TypeScript app with the Copilot SDK and a Telegram bot library.
- Add environment-based configuration for Telegram bot token, Copilot CLI/SDK settings, logging, and runtime mode.
- Define a minimal project structure for bot transport, Copilot client/session management, configuration, and utilities.

### 2. Establish Copilot runtime integration

- Create a reusable Copilot client wrapper that starts or connects to the Copilot CLI runtime.
- Add session creation and lifecycle management.
- Decide and implement the identity mapping strategy:
  - one session per Telegram user, or
  - one session per Telegram chat/thread
- Set a baseline system prompt describing the assistant role and Telegram-specific response constraints.
- Extend the baseline prompt with rules for when to seek, recommend, and use skills.

### 3. Design the skills subsystem

- Define what a "skill" means in the app: metadata, source, install status, version, and scope.
- Create a skill discovery service that queries `skill.sh` for relevant skills based on the user request.
- Create a skill installation flow that can:
  - present candidate skills to the user,
  - explain why each skill is useful,
  - install a selected skill,
  - track installed skills per user or globally, depending on the chosen model
- Decide how installed skills are exposed back to the assistant during later turns so it can actively use them while solving tasks.

### 4. Implement Telegram message handling

- Receive text messages and bot commands from Telegram.
- Normalize Telegram updates into a consistent internal request shape.
- Route user messages into the correct Copilot session and send the assistant response back to Telegram.
- Handle Telegram-specific UX concerns such as message length limits, markdown escaping, and replying in the correct chat.
- Add Telegram UX for skills, such as:
  - asking for confirmation before installation,
  - showing search results,
  - exposing installed skills,
  - providing progress and failure feedback

### 5. Add conversation and session controls

- Implement commands such as `/start`, `/help`, `/reset`, and optionally `/new`.
- Support clearing or recreating a session on demand.
- Add lightweight in-memory state for session lookup first; keep the code structured so persistence can be added later.
- Add skill-oriented commands such as `/skills`, `/searchskill`, or `/installskill` if command-based control is preferable in addition to natural-language requests.

### 6. Add reliability and guardrails

- Add error handling for CLI startup failures, Telegram API failures, invalid config, and interrupted sessions.
- Add timeout and concurrency handling so repeated Telegram messages do not corrupt session state.
- Add logging around inbound updates, Copilot requests, response timing, and failures.
- Add explicit safeguards around skill installation, including confirmation policy, duplicate installs, failed installs, and rollback or retry behavior where supported.

### 7. Prepare for future extensibility

- Keep assistant configuration modular so tools, custom prompts, attachments, memory backends, or alternate skill registries can be added later.
- Define clear seams for replacing in-memory session storage with Redis or a database if needed.
- Leave room for Telegram-specific enhancements such as voice notes, file uploads, inline keyboards, or admin-only commands.

### 8. Validate the integration

- Add basic tests for config parsing, session mapping, and Telegram update normalization.
- Add tests for skill search result mapping, install request validation, and installed-skill state management.
- Run the project’s build/type-check/test commands once the app scaffold exists.
- Perform a manual end-to-end Telegram bot check using a real bot token in local development, including at least one skill discovery and install flow.

## Suggested Initial File/Module Layout

- `src/config/*` for environment parsing and runtime options
- `src/copilot/*` for SDK client/session wrappers and assistant prompt config
- `src/skills/*` for `skill.sh` integration, install orchestration, and skill registry/state
- `src/telegram/*` for webhook or polling integration and Telegram command/message handlers
- `src/state/*` for session registry and future persistence abstraction
- `src/index.*` as the application entrypoint

## Key Decisions To Confirm

- Polling versus webhook delivery for Telegram
- Session identity model: per-user versus per-chat
- Whether skill installation should always require explicit user confirmation
- Whether installed skills are scoped per-user, per-chat, or globally
- Whether v1 should include custom tools, memory, or file attachment support alongside skills

## Notes

- Because the current workspace does not yet contain the actual SDK source or an existing bot app, the first implementation step will be project scaffolding rather than editing existing application files.
- The Copilot SDK report is strong enough to guide architecture, but implementation should still verify the current SDK API from installed package docs/examples during execution.
- The plan assumes `skill.sh` is the authoritative source for discovering and installing skills; implementation should confirm whether it exposes an API, CLI, package feed, or installation script pattern before coding the integration layer.
