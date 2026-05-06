# Troll tool

Single-operation transport-neutral tool:

- `run` — generate a reply comment from the curated history context and a single `prompt` input.

Exposed as:

- MCP tool: `troll`
- HTTP route: `POST /troll`

Notes:
- Input is limited to `{ "prompt": string }`.
- The handler suppresses debug/noise output.
- If no `comment` tool content is produced, the handler returns a silent no-content result.
