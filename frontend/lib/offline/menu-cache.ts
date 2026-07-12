import { getDb } from "./db";
import type { CachedMenu } from "./types";

/** Persist a menu snapshot for the given branch. */
export async function putMenu(
  branchId: string,
  menu: Omit<CachedMenu, "branchId" | "cachedAt">,
): Promise<void> {
  const db = await getDb();
  await db.put("menu_cache", { ...menu, branchId, cachedAt: Date.now() });
}

/** Retrieve the last cached menu for the given branch, or undefined. */
export async function getMenu(
  branchId: string,
): Promise<CachedMenu | undefined> {
  const db = await getDb();
  return db.get("menu_cache", branchId);
}
