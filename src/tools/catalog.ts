import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthenticatedUser } from "../auth.js";

export function registerCatalogTools(
  server: McpServer,
  user: AuthenticatedUser,
) {
  // 1. Tool: portal_list_releases
  server.tool(
    "portal_list_releases",
    "Lists releases owned by the authenticated user, with optional filtering by status (Draft, Processing, In Review, Approved, Rejected, Edit, Takedown).",
    {
      state: z.string().optional().describe("Optional state filter: Draft, Processing, In Review, Approved, Rejected, Edit, Takedown Pending, Takedown."),
      limit: z.number().min(1).max(100).default(20).describe("Maximum number of releases to return (default 20, max 100)."),
      offset: z.number().min(0).default(0).describe("Pagination offset (default 0)."),
    },
    async ({ state, limit, offset }) => {
      if (!user.scopes.includes("portal:catalog.read")) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Missing required scope 'portal:catalog.read'.",
            },
          ],
        };
      }

      let query = user.supabase
        .from("releases")
        .select("id, name, version, state, type, releaseday, upc, coverart_url, createdat, rejection_reason")
        .eq("user_id", user.userId)
        .order("createdat", { ascending: false })
        .range(offset, offset + limit - 1);

      if (state) {
        query = query.eq("state", state);
      }

      const { data, error } = await query;

      if (error) {
        return {
          content: [{ type: "text", text: `Error listing releases: ${error.message}` }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    },
  );

  // 2. Tool: portal_get_release_details
  server.tool(
    "portal_get_release_details",
    "Retrieves full metadata and tracklist for a specific release owned by the user.",
    {
      release_id: z.string().uuid().describe("The UUID of the release."),
    },
    async ({ release_id }) => {
      if (!user.scopes.includes("portal:catalog.read")) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Missing required scope 'portal:catalog.read'.",
            },
          ],
        };
      }

      const { data: release, error: releaseErr } = await user.supabase
        .from("releases")
        .select("*")
        .eq("id", release_id)
        .eq("user_id", user.userId)
        .maybeSingle();

      if (releaseErr || !release) {
        return {
          content: [
            {
              type: "text",
              text: releaseErr ? `Error: ${releaseErr.message}` : `Release not found or not owned by user.`,
            },
          ],
        };
      }

      const { data: tracks, error: tracksErr } = await user.supabase
        .from("tracks")
        .select("id, name, tracknumber, isrc, explicit, preview_start_seconds, original_mp3_url, compressedaudio_url, songwriters, featuredartists")
        .eq("release_id", release_id)
        .order("tracknumber", { ascending: true });

      if (tracksErr) {
        return {
          content: [{ type: "text", text: `Error fetching tracks: ${tracksErr.message}` }],
        };
      }

      const fullRelease = {
        ...release,
        tracks: tracks || [],
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(fullRelease, null, 2),
          },
        ],
      };
    },
  );

  // 3. Tool: portal_lint_release
  server.tool(
    "portal_lint_release",
    "Inspects a release against distribution compliance standards (DSP requirements, metadata integrity, missing ISRCs, cover art, track consistency).",
    {
      release_id: z.string().uuid().describe("The UUID of the release to lint."),
    },
    async ({ release_id }) => {
      if (!user.scopes.includes("portal:catalog.read")) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Missing required scope 'portal:catalog.read'.",
            },
          ],
        };
      }

      const { data: release, error: relErr } = await user.supabase
        .from("releases")
        .select("*")
        .eq("id", release_id)
        .eq("user_id", user.userId)
        .maybeSingle();

      if (relErr || !release) {
        return {
          content: [{ type: "text", text: relErr ? relErr.message : "Release not found." }],
        };
      }

      const { data: tracks } = await user.supabase
        .from("tracks")
        .select("*")
        .eq("release_id", release_id);

      const issues: Array<{ severity: "error" | "warning"; field: string; message: string }> = [];

      // Metadata checks
      if (!release.name || release.name.trim().length === 0) {
        issues.push({ severity: "error", field: "name", message: "Release title is missing." });
      }

      if (!release.coverart_url) {
        issues.push({ severity: "error", field: "coverart_url", message: "Cover artwork is missing." });
      }

      if (!release.genre_id) {
        issues.push({ severity: "error", field: "genre_id", message: "Primary genre is not selected." });
      }

      if (!release.pline || !release.pline_year) {
        issues.push({ severity: "warning", field: "pline", message: "P-line copyright info is incomplete." });
      }

      if (!release.cline || !release.cline_year) {
        issues.push({ severity: "warning", field: "cline", message: "C-line copyright info is incomplete." });
      }

      // Track checks
      if (!tracks || tracks.length === 0) {
        issues.push({ severity: "error", field: "tracks", message: "Release has no audio tracks." });
      } else {
        for (const trk of tracks) {
          const trackLabel = `Track #${trk.tracknumber || trk.id} (${trk.name || "Untitled"})`;

          if (!trk.name || trk.name.trim().length === 0) {
            issues.push({ severity: "error", field: `track.${trk.id}.name`, message: `${trackLabel}: Missing track name.` });
          }

          if (!trk.fileurl && !trk.compressedaudio_url) {
            issues.push({ severity: "error", field: `track.${trk.id}.audio`, message: `${trackLabel}: Missing audio master file.` });
          }

          if (!trk.isrc || trk.isrc.trim().length === 0) {
            issues.push({ severity: "warning", field: `track.${trk.id}.isrc`, message: `${trackLabel}: Missing ISRC code (will be auto-generated upon distribution if empty).` });
          }
        }
      }

      // Status check
      const isLocked = ["Processing", "In Review", "Approved", "Takedown Pending", "Takedown"].includes(release.state);

      const report = {
        release_id,
        title: release.name,
        current_state: release.state,
        is_locked_for_edits: isLocked,
        passed: issues.filter((i) => i.severity === "error").length === 0,
        errors_count: issues.filter((i) => i.severity === "error").length,
        warnings_count: issues.filter((i) => i.severity === "warning").length,
        issues,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(report, null, 2),
          },
        ],
      };
    },
  );
}
