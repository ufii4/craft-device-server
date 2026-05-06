# Images tool

Supports two transport-neutral operations:

- `search` — search stock images
- `edit` — edit local images

Exposed over MCP as the `images` tool with `method` dispatch, and over HTTP as:

- `POST /images/search`
- `POST /images/edit`
