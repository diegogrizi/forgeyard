/** Signal zero is a read-only liveness check. PID reuse/permission denial is
 * deliberately treated as alive, never as permission to kill a process. */
export function processMayBeAlive(pid: number | undefined): boolean {
  if (!Number.isSafeInteger(pid) || !pid || pid < 1) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
