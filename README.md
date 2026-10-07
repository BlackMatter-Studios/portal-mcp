# Portal Model Context Protocol (MCP) Server

Connect your Portal music distribution catalog and streaming analytics directly to **Claude Desktop**, **Cursor IDE**, and **ChatGPT**.

## Features

- **Streaming Trends & Analytics**: Ask your LLM about your daily stream counts, 30/90-day growth, DSP shares (Spotify vs Apple Music), and top-performing tracks.
- **Catalog Inspection & Compliance Linter**: Review tracklists, ISRC codes, UPCs, release artwork, and detect missing metadata before submission.
- **Safe Draft Fixes**: Edit release titles, genres, copyright lines, and track names on draft releases directly via AI prompts.
- **Kernel-Level Immutability**: All distributed, in-review, and approved releases are locked at the PostgreSQL database level (`triggers`), making unauthorized modifications structurally impossible.

---

## Quick Start: Connecting to Claude Desktop

### 1. Generate an MCP Token
Go to **Portal Settings** -> **AI & MCP Integrations** -> click **Generate Token**.
Select your desired permissions (`portal:analytics.read`, `portal:catalog.read`, `portal:catalog.write_draft`).
Copy your token (format: `pmcp_live_...`).

### 2. Configure Claude Desktop
Open your Claude Desktop configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the `portal` server:

```json
{
  "mcpServers": {
    "portal": {
      "command": "npx",
      "args": ["-y", "@blackmatter/portal-mcp"],
      "env": {
        "PORTAL_API_KEY": "pmcp_live_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Restart Claude Desktop. The hammer icon will show the Portal tools available!

---

## One-Click Install via Smithery

Install automatically for Claude Desktop using the Smithery CLI:

```bash
npx -y @smithery/cli install @blackmatter/portal-mcp --client claude
```

---

## Quick Start: Connecting to Cursor IDE

Add to your project's `.cursor/mcp.json` or your global Cursor MCP settings:

```json
{
  "mcpServers": {
    "portal": {
      "command": "npx",
      "args": ["-y", "@blackmatter/portal-mcp"],
      "env": {
        "PORTAL_API_KEY": "pmcp_live_YOUR_TOKEN_HERE"
      }
    }
  }
}
```


---

## Available Tools

| Tool | Scopes Required | Description |
|---|---|---|
| `portal_get_artist_analytics_summary` | `portal:analytics.read` | Total streams, 30d/90d counts, Spotify listeners for user's artists. |
| `portal_get_artist_analytics_detail` | `portal:analytics.read` | Granular breakdown per release and DSP for a specific artist ID. |
| `portal_list_releases` | `portal:catalog.read` | Lists user's releases with status filtering and pagination. |
| `portal_get_release_details` | `portal:catalog.read` | Complete release metadata, tracks, ISRCs, and artwork. |
| `portal_lint_release` | `portal:catalog.read` | Diagnoses missing metadata, empty genres, unlinked audio, or unassigned ISRCs. |
| `portal_update_release_draft` | `portal:catalog.write_draft` | Updates title, genre, copyright lines for Draft/Edit releases. |
| `portal_update_track_draft` | `portal:catalog.write_draft` | Updates track title, ISRC, explicit flag for Draft/Edit tracks. |
| `portal_submit_release_for_review` | `portal:catalog.write_draft` | Submits a valid draft for compliance review (`Processing`). |

---

## Security Guarantees

1. **Zero Service-Role Leaks**: The server never operates as a master admin. All requests are authenticated and bound to the user's `auth.uid()`.
2. **PostgreSQL RLS**: You can only ever see and touch data that your Portal account owns.
3. **Database-Level Immutability**:
   - `releases_enforce_immutability_on_locked_states`: Releases in `Processing`, `In Review`, `Approved`, `Takedown Pending`, or `Takedown` cannot have metadata modified or rows deleted.
   - `tracks_enforce_immutability_on_locked_release`: Tracks belonging to locked releases cannot be added, modified, or deleted.

---

## Remote Mode (SSE / HTTP)

For web clients, remote MCP hosts, and cloud agents:

```bash
npx -y @blackmatter/portal-mcp --sse --port=3000
```

- **SSE Endpoint**: `http://localhost:3000/sse`
- **Message Endpoint**: `http://localhost:3000/message`
- **Authentication**: Pass `Authorization: Bearer pmcp_live_...` or query parameter `?token=pmcp_live_...`.

---

## Development & Contributing

Contributions are welcome!

```bash
git clone https://github.com/BlackMatter-Studios/portal-mcp.git
cd portal-mcp
npm install
npm test
npm run build
```

Licensed under the [Apache-2.0 License](LICENSE).

