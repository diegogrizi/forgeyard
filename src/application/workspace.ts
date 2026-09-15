import path from "node:path";

import { loadConfig } from "../config/config.js";
import { loadTaskGraph } from "../orchestrator/graph.js";
import { createWorktreeService, type WorkspaceResult } from "../worktrees/service.js";

export interface WorkspaceCommandInput {
  action: "status" | "create" | "validate" | "integrate" | "cleanup";
  root: string;
  taskId: string;
  workerId: string;
}

export interface WorkspaceCommandResult {
  schemaVersion: 1;
  ok: true;
  command: "workspace";
  action: WorkspaceCommandInput["action"];
  root: string;
  workspace: WorkspaceResult;
}

export async function runWorkspaceCommand(input: WorkspaceCommandInput): Promise<WorkspaceCommandResult> {
  const root = path.resolve(input.root);
  const config = await loadConfig(path.join(root, "forgeyard.yaml"));
  const graph = await loadTaskGraph({
    root,
    mutableRoots: config.paths.mutableRoots,
    protectedPaths: config.paths.protectedPaths,
  });
  const service = createWorktreeService({
    root,
    graph,
    maxConcurrency: config.orchestration.maxConcurrency,
  });
  const workspace = await service[input.action]({ taskId: input.taskId, workerId: input.workerId });
  return {
    schemaVersion: 1,
    ok: true,
    command: "workspace",
    action: input.action,
    root,
    workspace,
  };
}
