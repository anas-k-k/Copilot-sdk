# Research Report: [github/copilot-sdk](https://github.com/github/copilot-sdk)

## Executive Summary

[github/copilot-sdk](https://github.com/github/copilot-sdk) is a schema-driven, multi-language SDK family that exposes the GitHub Copilot CLI runtime as a programmable JSON-RPC service instead of asking application authors to build their own agent orchestration layer. The main monorepo ships Node.js/TypeScript, Python, Go, and .NET SDKs, while Java lives in a separate repository referenced from the root README.[^1]

Architecturally, all shipped SDKs follow the same pattern: a client object either spawns or connects to a Copilot CLI server, negotiates protocol compatibility, creates a session wrapper, and then translates runtime events, tool requests, permission prompts, and telemetry context into language-idiomatic APIs.[^1][^2][^3][^4][^11][^16]

The repo is not just four hand-written SDKs sitting side by side. It is a monorepo with a shared schema/codegen pipeline, a shared replay-based HTTP test harness, cross-language scenario validation, and release-time packaging logic that stamps versions and, in some cases, bundles the CLI binary into artifacts.[^20][^21][^22][^23][^24][^25][^26]

The most important recent direction is cross-SDK parity: system-prompt customization, telemetry propagation, inline blob attachments, richer low-level RPC access, backward compatibility with v2 servers, and a more strongly typed Python surface all show up in the changelog and in the current implementation structure.[^28][^29][^30][^31]

## Architecture / System Overview

The repository’s own top-level documentation describes a simple but important deployment model: application code talks to an SDK client, the SDK speaks JSON-RPC, and the Copilot CLI runs as the actual server-side runtime.[^1]

```text
┌───────────────────────┐
│   Your application    │
└──────────┬────────────┘
           │ language-idiomatic API
┌──────────▼────────────┐
│ SDK client/session    │
│ Node / Python / Go /  │
│ .NET                  │
└──────────┬────────────┘
           │ JSON-RPC
┌──────────▼────────────┐
│ Copilot CLI server    │
│ planning, tool use,   │
│ edits, prompts, auth  │
└──────────┬────────────┘
           │ model / provider traffic
┌──────────▼────────────┐
│ Copilot / BYOK / CAPI │
└───────────────────────┘
```

Two version facts matter. First, the checked-in SDK protocol file says the current SDK protocol version is `3`.[^2] Second, the language clients explicitly accept older servers down to protocol version `2`, which matches the changelog note that v0.1.32 added backward compatibility with v2 CLI servers.[^3][^11][^16][^28]

## Component Analysis

### 1. Repository layout and language coverage

The root README positions the project as “Agents for every app,” names Python, TypeScript, Go, .NET, and Java, and makes an explicit distinction between the monorepo-hosted SDKs and the separate Java repository.[^1] The Node package is published as `@github/copilot-sdk`, depends on `@github/copilot`, `vscode-jsonrpc`, and `zod`, and ships both ESM and CJS entrypoints through its `exports` map.[^5] Python is packaged as `github-copilot-sdk` and requires Python `>=3.11`, while Go declares module path `github.com/github/copilot-sdk/go` and currently targets Go `1.24`.[^10][^15] The .NET package is `GitHub.Copilot.SDK`, opts into documentation and AOT compatibility metadata, and consumes `Microsoft.Extensions.AI`, `StreamJsonRpc`, and `System.Text.Json`.[^19]

One notable repo-level insight is that the documentation and manifests are not perfectly synchronized. The getting-started guide still advertises Node `18+`, Python `3.8+`, Go `1.21+`, and .NET `8.0+`, while the committed manifests currently require Node `>=20`, Python `>=3.11`, and Go `1.24`.[^27][^5][^10][^15] That mismatch suggests the source-of-truth for quickstart docs lags behind packaging constraints.

### 2. Client bootstrapping and process/runtime ownership

The Node client is the clearest expression of the core boot model. It defines a minimum protocol version, converts tool schemas to JSON Schema, extracts prompt-transform callbacks into a wire-safe payload, and resolves the bundled CLI from the `@github/copilot` package, including a CJS fallback for bundlers like esbuild.[^3][^4] Its constructor validates mutually exclusive options such as `cliUrl` versus `useStdio` / `cliPath`, separates external-server mode from child-process mode, defaults to autostart, and stores optional telemetry and model-listing hooks.[^4]

Go follows the same conceptual model with a more explicit systems-programming flavor. `Client` owns the spawned process or external socket, caches models, stores session wrappers, and verifies protocol compatibility in `Start()` after optionally starting the CLI process and connecting to the server.[^11] The Go repo also contains an `embeddedcli` installer that writes a versioned Copilot binary into a cache directory, verifies a SHA-256 hash, and uses a best-effort file lock so concurrent installs do not stomp each other.[^32]

The .NET client is structurally parallel to Node and Go: it stores connection state, sessions, negotiated protocol version, an optional model-list callback, and typed RPC access; `StartAsync()` either connects to an external TCP endpoint or spawns the CLI and then verifies protocol compatibility before marking the client connected.[^16] In all three cases, the repo is implementing a transport/process-management layer on top of the CLI runtime, not a separate agent engine.

### 3. Session model, events, and race avoidance

Every language exposes a session wrapper with the same core responsibilities: send prompts, subscribe to events, keep session-scoped RPC handles, and internally answer broadcast tool or permission requests emitted by the runtime.[^7][^12][^17] This is the real center of the SDK.

The Node session shows the pattern most directly. `send()` forwards `session.send` with prompt, attachments, mode, and trace context; `sendAndWait()` subscribes to events *before* calling `send()` specifically to avoid a race where `session.idle` could arrive before the handler is registered.[^7] The same class also owns tool handlers, permission handlers, user-input handlers, hooks, and system-message transform callbacks, and its private broadcast dispatcher fires local tool or permission responses back through typed RPC helpers.[^7]

Go and .NET make the eventing contract even more explicit. Go’s `Session` allocates a buffered `eventCh` and starts a dedicated `processEvents()` goroutine so user handlers are invoked serially in FIFO order, while broadcast work for tools and permissions is handled separately so the read loop is not blocked.[^12] .NET uses a single-reader `Channel<SessionEvent>` for the same reason and documents that handlers are invoked serially in event-arrival order on a background consumer.[^17] This is a good example of parity at the design level, not just the API surface.

### 4. Tools, permissions, hooks, and prompt customization

The SDKs are opinionated about letting application code participate in agent execution. Python’s session type definitions are a compact summary of that extensibility surface: it defines attachments, permission result kinds, user-input contracts, session hooks, BYOK provider config, MCP server config, custom agents, infinite sessions, and the `system_message` modes including `append`, `replace`, and `customize`.[^9]

The recently added system-prompt customization story is especially important. Python enumerates ten named prompt sections plus transform-capable overrides.[^9] Node and Go both implement `extractTransformCallbacks()` helpers that strip function-valued transforms out of the config, replace them with wire-level `"transform"` actions, and keep the real callbacks locally so the runtime can ask the SDK to mutate rendered sections later.[^3][^11] This is exactly the kind of cross-language feature that shows the repo is trying to keep semantic parity, not just naming parity.

Tool definition ergonomics are also language-specific in smart ways. Go’s `DefineTool` uses reflection plus `google/jsonschema-go` to derive JSON Schema from a typed handler parameter, marshals incoming JSON-RPC arguments into that typed struct, and normalizes return values so strings pass through while other values are JSON-serialized for the LLM.[^13] Node does a lighter-weight version by accepting raw JSON Schema or Zod schemas and converting Zod via `toJSONSchema()` before it goes over the wire.[^3]

### 5. Telemetry and trace propagation

Telemetry is intentionally asymmetric across languages. Node explicitly avoids taking an OpenTelemetry dependency; instead, it exposes a `TraceContextProvider` callback and returns `{}` when no provider is configured or the callback fails.[^6] That keeps the Node SDK lightweight, but it pushes actual trace extraction to the application.

Go and .NET embed deeper runtime integration. Go pulls `traceparent` and `tracestate` from the global OpenTelemetry propagator and can reconstruct a context from remote headers for tool execution.[^14] .NET reads `Activity.Current` for outbound context and can restore inbound W3C trace context by creating a temporary `Activity` so user-created child spans inherit the CLI-owned parent correctly.[^18] The changelog confirms this feature was rolled out across all four primary SDK languages as a coordinated capability, not as isolated one-off implementations.[^28]

### 6. Schema/codegen pipeline and cross-language parity

The strongest evidence that this repo is designed as one system is the shared codegen layer under `scripts/codegen`. The package is a small internal TypeScript project whose only job is to generate TypeScript, C#, Python, and Go outputs from shared schemas.[^24] The TypeScript generator reads session-event and API schemas, compiles types, and emits typed `createServerRpc()` / `createSessionRpc()` helpers.[^20]

Python and Go take a more post-processed quicktype path. The Python generator modernizes quicktype output to Python 3.11+ syntax, injects forward-compatible unknown event handling, derives wrapper classes for server/session RPC, and reconciles quicktype-generated names back into the emitted wrappers so acronyms like `MCP` do not break references.[^21] The Go generator does the same kind of reconciliation while also repairing quicktype enum naming into canonical Go `TypeNameValue` form and extracting actual field names from generated structs so wrapper code stays aligned with generated identifiers.[^22]

The C# generator goes even further on API polish: it emits XML docs, applies rename overrides to awkward generated type names, generates polymorphic event hierarchies, and formats output through `dotnet format` when available.[^23] In practice, that means the hand-written layer stays relatively thin while schema-derived RPC and event models do most of the compatibility work.

### 7. Packaging and release mechanics

This repo’s packaging logic is more sophisticated than the committed manifest versions initially suggest. The Node package includes a `package` script that builds, runs `scripts/set-version.js`, packs the tarball, and then resets the checked-in version again; the helper script itself stamps `process.env.VERSION` into `package.json` at packaging time.[^5][^33] That helps explain why the checked-in Node manifest can differ from the release train described in the changelog.[^28]

Python’s wheel builder is even more explicit about release-time assembly. `python/scripts/build-wheels.mjs` downloads platform-specific `@github/copilot-<platform>` binaries from npm, embeds them into `copilot/bin`, copies the CLI license, rewrites `pyproject.toml` package-data, and repacks wheels with correct platform tags.[^34] The .NET project also ties itself back to the Node side during packaging by generating props from the `@github/copilot` version stored in `nodejs/package-lock.json`.[^19] In other words, the monorepo uses Node’s Copilot dependency as the canonical CLI version anchor.

### 8. Test harness, scenarios, and documentation validation

Testing is deliberately centralized. The root `justfile` runs format/lint/test targets for all four languages, installs the shared `test/harness` package before Go/Python/.NET test runs, and also validates extracted documentation samples and cross-language scenario builds.[^25] That is a strong signal that the maintainers treat behavioral parity as a repo-wide concern.

The replay harness is particularly interesting. `ReplayingCapiProxy` stores normalized OpenAI-style chat completion exchanges on a one-file-per-test basis, can replay cached `/chat/completions` and `/models` traffic, and intentionally hangs responses for timeout scenarios when a snapshot is request-only.[^26] This gives the repo stable, human-diffable fixtures for model-adjacent behavior without requiring live network calls for every test case.

## Recent Evolution

The v0.2.0 changelog shows a broad parity push: fine-grained system prompt customization, OpenTelemetry support across all four SDK languages, inline blob attachments, agent preselection, skip-permission tool support, model-reasoning controls, richer RPC surfaces, and multiple language-specific improvements all landed as part of the same release wave.[^28]

The most recent commits reinforce that trend. Commit `005b780` added fine-grained system prompt customization and transform callbacks across all four core SDK languages.[^29] Commit `1ff9e1b` updated the underlying `@github/copilot` dependency to `1.0.10` and re-ran generators.[^30] Commit `7463c54` then continued the Python API cleanup by removing `copilot.types` and restoring missing customization-related types and transform support after rebase churn.[^31]

## Key Repositories Summary

| Repository | Purpose | Key Evidence |
|---|---|---|
| [github/copilot-sdk](https://github.com/github/copilot-sdk) | Main monorepo for Node, Python, Go, and .NET SDKs plus shared docs, tests, and codegen | Root README, `nodejs/`, `python/`, `go/`, `dotnet/`, `scripts/codegen/`[^1][^20][^24] |
| [github/copilot-sdk-java](https://github.com/github/copilot-sdk-java) | Separate Java SDK repository referenced from the main README | Root README SDK table[^1] |

## Confidence Assessment

**High confidence:** repository structure, runtime architecture, session/event design, telemetry strategy, codegen model, packaging/release flow, and testing approach. These were all directly verified from repository source files, manifests, docs, and recent commit metadata.[^1][^3][^11][^16][^20][^25]

**Medium confidence:** exact release mechanics for every published artifact version. The repo clearly stamps or assembles artifacts during packaging, but some checked-in manifest versions differ from the published release history described in `CHANGELOG.md`, so the report treats the release train as authoritative while noting the checked-in manifest mismatch.[^5][^19][^28][^33][^34]

**Known limits:** this report covers the SDK repository and its direct integration points. It does **not** reverse-engineer the Copilot CLI server implementation itself, because that runtime lives outside this repository; where behavior depends on the external runtime, I relied on the SDK contracts, changelog, and comments rather than speculating about the server internals.[^1][^28]

## Footnotes

[^1]: `README.md:11-23, 41-53` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^2]: `sdk-protocol-version.json:1-3` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^3]: `nodejs/src/client.ts:48-153` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^4]: `nodejs/src/client.ts:238-301` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^5]: `nodejs/package.json:1-31, 57-84` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^6]: `nodejs/src/telemetry.ts:5-27` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^7]: `nodejs/src/session.ts:55-123, 128-164, 147-160, 228-374` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^8]: `python/copilot/client.py:49-125` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^9]: `python/copilot/session.py:41-170, 287-487` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^10]: `python/pyproject.toml:1-41` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^11]: `go/client.go:45-179, 208-253, 355-470` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^12]: `go/session.go:42-91, 114-198, 351-548` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^13]: `go/definetool.go:15-117` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^14]: `go/telemetry.go:1-31` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^15]: `go/go.mod:1-18` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^16]: `dotnet/src/Client.cs:20-151, 196-233, 308-403` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^17]: `dotnet/src/Session.cs:17-36, 53-93, 127-177, 248-330, 392-447` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^18]: `dotnet/src/Telemetry.cs:7-43` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^19]: `dotnet/src/GitHub.Copilot.SDK.csproj:3-18, 34-41, 43-71` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^20]: `scripts/codegen/typescript.ts:30-119, 121-180` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^21]: `scripts/codegen/python.ts:20-84, 117-164, 171-368` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^22]: `scripts/codegen/go.ts:21-126, 132-386` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^23]: `scripts/codegen/csharp.ts:20-146` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^24]: `scripts/codegen/package.json:1-15` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^25]: `justfile:5-12, 48-90` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^26]: `test/harness/replayingCapiProxy.ts:24-52, 135-259` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^27]: `docs/getting-started.md:6-55` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^28]: `CHANGELOG.md:8-77, 108-173` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^29]: Commit `005b780c3b4d320ccbba37d0873d730dfaacc9c5`, “Add fine-grained system prompt customization (customize mode)” ([github/copilot-sdk](https://github.com/github/copilot-sdk/commit/005b780c3b4d320ccbba37d0873d730dfaacc9c5))
[^30]: Commit `1ff9e1b84a06cada43da99919526bcd87d445556`, “Update @github/copilot to 1.0.10” ([github/copilot-sdk](https://github.com/github/copilot-sdk/commit/1ff9e1b84a06cada43da99919526bcd87d445556))
[^31]: Commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`, “[Python] Remove `copilot.types`” ([github/copilot-sdk](https://github.com/github/copilot-sdk/commit/7463c54d021017e27e0c9a3b15ae7b3e0630047a))
[^32]: `go/internal/embeddedcli/embeddedcli.go:14-121` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^33]: `nodejs/scripts/set-version.js:1-9` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
[^34]: `python/scripts/build-wheels.mjs:1-220` ([github/copilot-sdk](https://github.com/github/copilot-sdk), commit `7463c54d021017e27e0c9a3b15ae7b3e0630047a`)
