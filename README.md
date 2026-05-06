# craft-device-server

Local HTTP + MCP device server for personal automation tools.

## What it does

`craft-device-server` is a small local runtime that:

- serves an HTTP API
- serves an MCP endpoint
- loads tools from a user-scoped runtime config root
- hot-reloads config changes
- executes tool handlers as external commands with `shell: false`

The current bundled seed tools are:

- `images`
- `notify`
- `troll`

## Default runtime config location

By default the runtime uses:

- `~/.craft-agent/device-server`

On this machine that resolves to:

- `/Users/ufi/.craft-agent/device-server`

The package seeds missing runtime files into that directory on startup.

## Runtime layout

```text
~/.craft-agent/device-server/
  http-routes.json               # legacy compatibility
  mcp-tools.json                 # legacy compatibility
  handlers/                      # legacy compatibility
  tools/
    images/
      config.json
      guide.md
      handler.mjs
      operations/
        search.definition.mjs
        edit.definition.mjs
    notify/
      config.json
      guide.md
      handler.mjs
      operations/
        send.definition.mjs
    troll/
      config.json
      guide.md
      handler.mjs
      context.json
      operations/
        run.definition.mjs
```

## Transport model

Each tool owns:

- its operations
- its transport exposure
- its handler executable

Operation definitions are transport-neutral modules that export:

- `parse(rawInput, context)`

HTTP and MCP both flow through the same operation parsing boundary before handler execution.

## Current bundled tools

### `images`

Exposed as:

- MCP tool: `images`
- HTTP routes:
  - `POST /images/search`
  - `POST /images/edit`

### `notify`

Exposed as:

- HTTP route: `POST /notify`

### `troll`

Exposed as:

- MCP tool: `troll`
- HTTP route: `POST /troll`

Input:

```json
{
  "prompt": "..."
}
```

Behavior:

- on success, surfaces only the generated comment text
- on no-comment / skip, returns silent no-content
- suppresses debug/noise output

## Required environment variables

### Required

- `CRAFT_DEVICE_SERVER_TOKEN`

### Optional server/runtime config

- `CRAFT_DEVICE_SERVER_HOST` — default `127.0.0.1`
- `CRAFT_DEVICE_SERVER_PORT` — default `9797`
- `CRAFT_DEVICE_SERVER_CONFIG_DIR` — explicit runtime config directory override
- `CRAFT_CONFIG_DIR` — changes the parent Craft config root used by the default runtime dir

### Optional provider/tool credentials

- `OPENAI_API_KEY` — used by `images.edit`
- `PEXELS_API_KEY` — used by `images.search`
- `OPENROUTER_API_KEY` — used by `troll`

## Start the server

From this package:

```bash
bun run start
```

Or directly:

```bash
CRAFT_DEVICE_SERVER_TOKEN='your-token' bun run src/index.ts
```

On startup it prints:

- `CRAFT_DEVICE_SERVER_URL=...`
- `CRAFT_DEVICE_SERVER_MCP_URL=...`

## Development

### Typecheck

```bash
bun run typecheck
```

### Tests

```bash
bun test src/__tests__
```

## Notes on migration compatibility

The runtime currently supports both:

- tool-folder config under `tools/*/config.json`
- legacy central config (`http-routes.json`, `mcp-tools.json`, `handlers/*`)

During the migration window:

- tool-folder entries are loaded first
- legacy entries are also loaded if present
- tool-folder entries win on conflicts
- legacy-only routes/tools remain active until migrated
