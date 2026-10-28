// `node --test` runs test files in parallel. Two embedded Postgres servers starting at the same time on Windows
// fail with "Is another postmaster already running". Test files that boot one take this cross-process lock first.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LOCK_DIR = path.join(os.tmpdir(), "stampa-embedded-pg.lock");
const STALE_MS = 15 * 60 * 1000;

export async function acquireEmbeddedPgLock() {
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      return () => fs.rmSync(LOCK_DIR, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(LOCK_DIR).mtimeMs > STALE_MS) fs.rmSync(LOCK_DIR, { recursive: true, force: true });
      } catch {
        // released between the check and the stat: just retry
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
