import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthenticatedUser } from "../auth.js";

export function registerAnalyticsTools(
  server: McpServer,
  user: AuthenticatedUser,
) {
  // 1. Tool: portal_get_artist_analytics_summary
  server.tool(
    "portal_get_artist_analytics_summary",
    "Retrieves streaming analytics trends, total streams, 30-day and 90-day performance, and Spotify stats for the user's artists.",
    {},
    async () => {
      if (!user.scopes.includes("portal:analytics.read")) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Missing required scope 'portal:analytics.read'. Please regenerate your MCP token with analytics permissions.",
            },
          ],
        };
      }

      const { data, error } = await user.supabase.rpc("get_artist_analytics_catalog", {
        p_user_id: user.userId,
      });

      if (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to load artist analytics: ${error.message}`,
            },
          ],
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

  // 2. Tool: portal_get_artist_analytics_detail
  server.tool(
    "portal_get_artist_analytics_detail",
    "Retrieves granular consumption analytics for a specific artist, including releases, DSP streams, and top facts.",
    {
      artist_id: z.string().uuid().describe("The UUID of the artist to retrieve detailed analytics for."),
    },
    async ({ artist_id }) => {
      if (!user.scopes.includes("portal:analytics.read")) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Missing required scope 'portal:analytics.read'.",
            },
          ],
        };
      }

      const { data, error } = await user.supabase.rpc("get_artist_analytics_detail", {
        p_user_id: user.userId,
        p_artist_id: artist_id,
      });

      if (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to load detailed artist analytics: ${error.message}`,
            },
          ],
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
}
