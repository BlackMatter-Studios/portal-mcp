import test from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { authenticateKey } from "../dist/auth.js";

test("API Key validation requires pmcp_ prefix", async () => {
  await assert.rejects(
    async () => {
      await authenticateKey(
        "invalid_key_123",
        "https://example.supabase.co",
        "anon_key",
      );
    },
    {
      message: /Invalid API key format/,
    },
  );
});

test("SHA-256 hash calculation is deterministic", () => {
  const token = "pmcp_live_0123456789abcdef0123456789abcdef";
  const hash1 = crypto.createHash("sha256").update(token).digest("hex");
  const hash2 = crypto.createHash("sha256").update(token).digest("hex");

  assert.strictEqual(hash1, hash2);
  assert.strictEqual(hash1.length, 64);
});
