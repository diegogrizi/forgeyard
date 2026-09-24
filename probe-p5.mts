import { workspaceIdentity, workspaceSnapshot } from "./src/native/workspace.js";
import { discoverWorkspace } from "./src/workspace/discovery.js";
const root = process.argv[2]!;
const d = await discoverWorkspace(root);
console.log("ricognizione  : kind=%s  repository=%d  progetti=%d", d.kind, d.repositories.length, d.projects.length);
console.log("                repos:", d.repositories.map((r) => r.path).join(", "));
try {
  const id = await workspaceIdentity(root);
  console.log("identita'     : commonDirectory=%s", id.commonDirectory ?? "NULL");
  const snap = await workspaceSnapshot(root);
  console.log("snapshot      : head=%s  clean=%s", snap.head ?? "NULL", snap.clean);
} catch (e) {
  console.log("identita'     : ERRORE", (e as { code?: string }).code, (e as Error).message.slice(0, 80));
}
