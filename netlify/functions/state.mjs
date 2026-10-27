import { getStore } from "@netlify/blobs";

const STORE = "chequein-sales-os";
const KEY = "state";
const MAX_BYTES = 900000;

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export default async function handler(req) {
  const code = req.headers.get("x-team-code") || "";
  const expected = process.env.TEAM_CODE;
  if (!expected || code !== expected) {
    return reply(401, { error: "unauthorized" });
  }

  const store = getStore({ name: STORE, consistency: "strong" });

  if (req.method === "GET") {
    const data = await store.get(KEY, { type: "json" });
    if (!data) return reply(404, { error: "empty" });
    return reply(200, data);
  }

  if (req.method === "POST") {
    const raw = await req.text();
    if (raw.length > MAX_BYTES) return reply(413, { error: "too_large" });

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, { error: "bad_json" });
    }

    if (!body || !body.state || !Array.isArray(body.state.employers)) {
      return reply(400, { error: "bad_state" });
    }

    const current = (await store.get(KEY, { type: "json" })) || { version: 0 };
    const currentVersion = Number(current.version) || 0;

    if (!body.force && Number(body.baseVersion || 0) !== currentVersion) {
      return reply(409, Object.assign({ error: "conflict" }, current));
    }

    const next = {
      version: currentVersion + 1,
      state: body.state,
      updatedAt: new Date().toISOString(),
      updatedBy: String(body.editor || "").slice(0, 60),
    };

    await store.setJSON(KEY, next);
    return reply(200, {
      version: next.version,
      updatedAt: next.updatedAt,
      updatedBy: next.updatedBy,
    });
  }

  return reply(405, { error: "method" });
}
