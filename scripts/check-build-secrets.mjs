// CI safety net (SECURITY-FIXES.md, section 3.3): scan the frontend build output for a
// leaked Supabase service_role key. The anon/publishable key is also a JWT (starts with
// "eyJ") and is *expected* in the frontend bundle, so a plain "eyJ" grep would false-positive
// on every build. Instead, decode each JWT-looking match and flag it only if its payload
// claims role=service_role, or if it matches SUPABASE_SERVICE_ROLE_KEY from the environment.
// server.cjs/server.cjs.map are excluded — they run server-side only and are expected to
// embed SUPABASE_SERVICE_ROLE_KEY.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const DIST_DIR = "dist";
const EXCLUDED_FILES = new Set(["server.cjs", "server.cjs.map"]);
const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".html", ".css", ".json", ".map"]);
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

function isServiceRoleToken(token) {
  if (SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) return true;
  try {
    const payloadSegment = token.split(".")[1];
    const json = Buffer.from(payloadSegment, "base64url").toString("utf8");
    const payload = JSON.parse(json);
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

let files;
try {
  files = walk(DIST_DIR);
} catch (err) {
  console.error(`[check:secrets] Impossible de lire "${DIST_DIR}" : ${err.message}`);
  process.exit(1);
}

const leaks = [];

for (const filePath of files) {
  const fileName = filePath.split(/[\\/]/).pop();
  if (EXCLUDED_FILES.has(fileName)) continue;
  if (!SCANNED_EXTENSIONS.has(extname(filePath))) continue;

  const content = readFileSync(filePath, "utf8");
  const matches = content.match(JWT_PATTERN) || [];
  const serviceRoleMatches = matches.filter(isServiceRoleToken);
  if (serviceRoleMatches.length > 0) {
    leaks.push({ filePath, count: serviceRoleMatches.length });
  }
}

if (leaks.length > 0) {
  console.error("[check:secrets] Fuite de clé service_role détectée dans le build frontend :");
  for (const leak of leaks) {
    console.error(`  - ${leak.filePath} (${leak.count} occurrence(s))`);
  }
  console.error("Vérifiez qu'aucune variable VITE_* ne contient SUPABASE_SERVICE_ROLE_KEY avant de déployer.");
  process.exit(1);
}

console.log("[check:secrets] OK : aucune clé service_role détectée dans le build frontend.");
