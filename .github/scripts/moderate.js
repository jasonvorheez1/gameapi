// Runs inside the GitHub Actions runner (~7GB memory) - see
// .github/workflows/moderate.yml for why this isn't done in the Supabase
// Edge Function anymore. Reads the payload the Edge Function dispatched,
// applies it to the local checked-out files, and leaves the result on disk
// for the workflow's own "git add/commit/push" step to ship.
const fs = require("fs");

const GAMEAPI_PATH = "gameapi.json";
const ANNOUNCE_PATH = "announcements.json";
const PENDING_PATH = "pending-suggestions.json";

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}
function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}
function earliestFreeId(chars) {
  const used = new Set();
  for (const c of chars) {
    const id = Number(c.Id ?? c.id);
    if (Number.isFinite(id)) used.add(id);
  }
  let id = 1;
  while (used.has(id)) id++;
  return id;
}

const payload = JSON.parse(process.env.PAYLOAD || "{}");
const { action } = payload;
const now = Date.now();

const chars = readJson(GAMEAPI_PATH);
const announcements = readJson(ANNOUNCE_PATH);
const pending = readJson(PENDING_PATH);

if (action === "bulk_add") {
  const items = Array.isArray(payload.characters) ? payload.characters : [];
  const added = [], skipped = [];
  for (const it of items) {
    const name = String(it.name || "").trim();
    const franchise = String(it.franchise || "Unknown").trim() || "Unknown";
    if (!name) { skipped.push({ name, franchise, reason: "missing name" }); continue; }
    const nameLower = name.toLowerCase();
    const dup = chars.find((c) => String(c.Name || "").trim().toLowerCase() === nameLower && String(c.Franchise || "").trim().toLowerCase() === franchise.toLowerCase());
    if (dup && !it.force) { skipped.push({ name, franchise, reason: `already exists as id ${dup.Id ?? dup.id}` }); continue; }
    const images = Array.isArray(it.images) ? it.images.filter((u) => typeof u === "string" && u.trim()) : [];
    const charId = earliestFreeId(chars);
    chars.push({ Id: charId, Name: name, Franchise: franchise, imageUrls: images });
    announcements.push({ id: `bulk_${charId}_${now}`, ts: now, type: "character", charId, name, franchise, by: payload.by || "admin" });
    added.push({ id: charId, name, franchise });
  }
  writeJson(GAMEAPI_PATH, chars);
  writeJson(ANNOUNCE_PATH, announcements.slice(-1000));
  console.log(`bulk_add: added ${added.length}, skipped ${skipped.length}`);
  console.log(JSON.stringify({ added, skipped }, null, 2));
} else if (action === "remove") {
  const cid = String(payload.characterId || "");
  const target = chars.find((c) => String(c.Id ?? c.id) === cid);
  const next = chars.filter((c) => String(c.Id ?? c.id) !== cid);
  announcements.push({ id: `rm_${cid}_${now}`, ts: now, type: "remove", characterId: cid, name: payload.name || target?.Name || "" });
  writeJson(GAMEAPI_PATH, next);
  writeJson(ANNOUNCE_PATH, announcements.slice(-1000));
  console.log(`remove: ${cid} (${target ? "found" : "not found"})`);
} else if (action === "accept") {
  const id = String(payload.id || "");
  const s = pending.find((x) => x.id === id);
  if (!s) {
    console.log("accept: suggestion not found (already gone?)");
  } else {
    let gameDirty = false;
    if (s.type === "character") {
      const charId = earliestFreeId(chars);
      chars.push({ Id: charId, Name: s.name, Franchise: s.franchise || "Unknown", imageUrls: Array.isArray(s.imageUrls) ? s.imageUrls : [] });
      announcements.push({ id: s.id, ts: now, type: "character", charId, name: s.name, franchise: s.franchise || "Unknown", by: s.by });
      gameDirty = true;
    } else if (s.type === "image") {
      const c = chars.find((c) => String(c.Id) === String(s.characterId)) || chars.find((c) => String(c.Name).toLowerCase() === String(s.characterName || "").toLowerCase());
      if (c) {
        c.imageUrls = Array.isArray(c.imageUrls) ? c.imageUrls : [];
        if (s.imageUrl && !c.imageUrls.includes(s.imageUrl)) c.imageUrls.push(s.imageUrl);
        announcements.push({ id: s.id, ts: now, type: "image", characterId: String(c.Id), characterName: c.Name, imageUrl: s.imageUrl, by: s.by });
        gameDirty = true;
      } else {
        console.log("accept: character not found for image suggestion " + id);
      }
    } else if (s.type === "series") {
      announcements.push({ id: s.id, ts: now, type: "series", franchise: s.franchise, by: s.by });
    }
    writeJson(PENDING_PATH, pending.filter((x) => x.id !== id));
    writeJson(ANNOUNCE_PATH, announcements.slice(-1000));
    if (gameDirty) writeJson(GAMEAPI_PATH, chars);
    console.log(`accept: ${id} (${s.type})`);
  }
} else if (action === "reject") {
  const id = String(payload.id || "");
  writeJson(PENDING_PATH, pending.filter((x) => x.id !== id));
  console.log(`reject: ${id}`);
} else {
  console.error("Unknown action: " + action);
  process.exit(1);
}
