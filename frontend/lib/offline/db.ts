import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { OutboxOp, OutboxStatus, CachedMenu, MetaEntry } from "./types";

interface PosDB extends DBSchema {
  outbox: {
    key: string;
    value: OutboxOp;
    indexes: {
      "by-status": OutboxStatus;
      "by-createdAt": number;
    };
  };
  menu_cache: {
    key: string; // branchId
    value: CachedMenu;
  };
  meta: {
    key: string;
    value: MetaEntry;
  };
}

const DB_NAME = "restaurantos-pos";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<PosDB>> | null = null;

/** Open (or return the cached) POS IndexedDB instance. */
export function getDb(): Promise<IDBPDatabase<PosDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PosDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("outbox")) {
          const outboxStore = db.createObjectStore("outbox", { keyPath: "id" });
          outboxStore.createIndex("by-status", "status");
          outboxStore.createIndex("by-createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains("menu_cache")) {
          db.createObjectStore("menu_cache", { keyPath: "branchId" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Reset the cached DB promise. Call this in tests (via fake-indexeddb) before
 * each test to ensure a clean in-memory database.
 */
export function resetDb(): void {
  dbPromise = null;
}
