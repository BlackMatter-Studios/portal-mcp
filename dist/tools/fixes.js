import { z } from "zod";
const LOCKED_STATES = [
    "Processing",
    "In Review",
    "Approved",
    "Takedown Pending",
    "Takedown",
];
export function registerFixesTools(server, user) {
    // 1. Tool: portal_update_release_draft
    server.tool("portal_update_release_draft", "Updates metadata for a release in an editable state (Draft, Edit, or Rejected). If the release is locked (Processing, In Review, Approved, Takedown), this tool and the database will reject the modification.", {
        release_id: z.string().uuid().describe("The UUID of the release."),
        name: z.string().optional().describe("New release title."),
        version: z.string().optional().describe("Optional version / edition (e.g. Deluxe, Remastered, Acoustic)."),
        genre_id: z.string().optional().describe("Primary genre ID."),
        subgenre_id: z.string().optional().describe("Secondary genre ID."),
        pline: z.string().optional().describe("P-line phonographic copyright owner name."),
        cline: z.string().optional().describe("C-line copyright owner name."),
    }, async ({ release_id, name, version, genre_id, subgenre_id, pline, cline, }) => {
        if (!user.scopes.includes("portal:catalog.write_draft")) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Error: Missing required scope 'portal:catalog.write_draft'. Please regenerate your token with draft write permissions.",
                    },
                ],
            };
        }
        // 1. Pre-check release state in application layer
        const { data: release, error: fetchErr } = await user.supabase
            .from("releases")
            .select("id, state, name")
            .eq("id", release_id)
            .eq("user_id", user.userId)
            .maybeSingle();
        if (fetchErr || !release) {
            return {
                content: [
                    {
                        type: "text",
                        text: fetchErr ? fetchErr.message : `Release ${release_id} not found or not owned by user.`,
                    },
                ],
            };
        }
        if (LOCKED_STATES.includes(release.state)) {
            return {
                content: [
                    {
                        type: "text",
                        text: `SECURITY VIOLATION: Release is in locked state "${release.state}". Distributed or in-review releases cannot be modified.`,
                    },
                ],
            };
        }
        // Build payload with only defined fields
        const updates = {
            modifiedat: new Date().toISOString(),
        };
        if (name !== undefined)
            updates.name = name.trim();
        if (version !== undefined)
            updates.version = version.trim();
        if (genre_id !== undefined)
            updates.genre_id = genre_id;
        if (subgenre_id !== undefined)
            updates.subgenre_id = subgenre_id;
        if (pline !== undefined)
            updates.pline = pline.trim();
        if (cline !== undefined)
            updates.cline = cline.trim();
        // Execute update — Postgres trigger enforce_release_immutability_on_locked_states also enforces at DB level
        const { data: updated, error: updateErr } = await user.supabase
            .from("releases")
            .update(updates)
            .eq("id", release_id)
            .eq("user_id", user.userId)
            .select("id, name, version, genre_id, subgenre_id, pline, cline, state, modifiedat")
            .single();
        if (updateErr) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Database error updating release: ${updateErr.message}`,
                    },
                ],
            };
        }
        return {
            content: [
                {
                    type: "text",
                    text: `Successfully updated release draft:\n${JSON.stringify(updated, null, 2)}`,
                },
            ],
        };
    });
    // 2. Tool: portal_update_track_draft
    server.tool("portal_update_track_draft", "Updates metadata for a specific track (name, version, explicit flag, ISRC). Both application and database strictly block modification if the parent release is in a locked/distributed state.", {
        track_id: z.string().uuid().describe("The UUID of the track to update."),
        name: z.string().optional().describe("New track name."),
        isrc: z.string().optional().describe("Track ISRC code (12 characters)."),
        explicit: z.boolean().optional().describe("Explicit content flag."),
        preview_start_seconds: z.number().optional().describe("TikTok / Ringtone / Preview start offset in seconds."),
    }, async ({ track_id, name, isrc, explicit, preview_start_seconds, }) => {
        if (!user.scopes.includes("portal:catalog.write_draft")) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Error: Missing required scope 'portal:catalog.write_draft'.",
                    },
                ],
            };
        }
        // Fetch track and parent release
        const { data: track, error: trackErr } = await user.supabase
            .from("tracks")
            .select("id, release_id, name")
            .eq("id", track_id)
            .eq("user_id", user.userId)
            .maybeSingle();
        if (trackErr || !track) {
            return {
                content: [
                    {
                        type: "text",
                        text: trackErr ? trackErr.message : `Track ${track_id} not found or not owned by user.`,
                    },
                ],
            };
        }
        // Check parent release state
        const { data: release } = await user.supabase
            .from("releases")
            .select("state")
            .eq("id", track.release_id)
            .maybeSingle();
        if (release && LOCKED_STATES.includes(release.state)) {
            return {
                content: [
                    {
                        type: "text",
                        text: `SECURITY VIOLATION: Parent release is in locked state "${release.state}". Tracks cannot be modified.`,
                    },
                ],
            };
        }
        const updates = {};
        if (name !== undefined)
            updates.name = name.trim();
        if (isrc !== undefined)
            updates.isrc = isrc.trim().toUpperCase();
        if (explicit !== undefined)
            updates.explicit = explicit;
        if (preview_start_seconds !== undefined)
            updates.preview_start_seconds = preview_start_seconds;
        // Update track — Postgres trigger tracks_enforce_immutability_on_locked_release protects at DB level
        const { data: updatedTrack, error: updateErr } = await user.supabase
            .from("tracks")
            .update(updates)
            .eq("id", track_id)
            .eq("user_id", user.userId)
            .select("id, name, isrc, explicit, preview_start_seconds, tracknumber")
            .single();
        if (updateErr) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Database error updating track: ${updateErr.message}`,
                    },
                ],
            };
        }
        return {
            content: [
                {
                    type: "text",
                    text: `Successfully updated track:\n${JSON.stringify(updatedTrack, null, 2)}`,
                },
            ],
        };
    });
    // 3. Tool: portal_submit_release_for_review
    server.tool("portal_submit_release_for_review", "Submits an eligible release (Draft or Edit) for compliance processing and admin review.", {
        release_id: z.string().uuid().describe("The UUID of the release to submit."),
    }, async ({ release_id }) => {
        if (!user.scopes.includes("portal:catalog.write_draft")) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Error: Missing required scope 'portal:catalog.write_draft'.",
                    },
                ],
            };
        }
        // Check current state
        const { data: release, error: fetchErr } = await user.supabase
            .from("releases")
            .select("id, state, name")
            .eq("id", release_id)
            .eq("user_id", user.userId)
            .maybeSingle();
        if (fetchErr || !release) {
            return {
                content: [{ type: "text", text: fetchErr ? fetchErr.message : "Release not found." }],
            };
        }
        if (release.state !== "Draft" && release.state !== "Edit") {
            return {
                content: [
                    {
                        type: "text",
                        text: `Release cannot be submitted from current state "${release.state}". Must be in "Draft" or "Edit".`,
                    },
                ],
            };
        }
        // Update state to 'Processing'
        const { data: updated, error: updateErr } = await user.supabase
            .from("releases")
            .update({
            state: "Processing",
            modifiedat: new Date().toISOString(),
        })
            .eq("id", release_id)
            .eq("user_id", user.userId)
            .select("id, name, state")
            .single();
        if (updateErr) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error submitting release: ${updateErr.message}`,
                    },
                ],
            };
        }
        return {
            content: [
                {
                    type: "text",
                    text: `Release "${updated.name}" successfully submitted for review (state: Processing).`,
                },
            ],
        };
    });
}
