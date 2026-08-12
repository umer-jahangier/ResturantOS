"use client";

import { useEffect, useReducer } from "react";
import { useMutation } from "@tanstack/react-query";

import { FileRepository } from "@/lib/repositories/file.repository";
import {
  MENU_IMAGE_ACCEPTED_TYPES,
  MENU_IMAGE_MAX_BYTES,
  type UploadedFile,
} from "@/lib/api-client/schemas/file.schema";
// Type-only import — permitted from lib/hooks/** (the layer-boundary rule covers components/**
// and app/** only); same justification use-menu-admin.ts gives for the identical import.
import type { ApiError } from "@/lib/api-client/errors";

/** Uploads a menu-item picture and resolves with the stored file's id + derived download URL. */
export function useUploadMenuItemImage() {
  return useMutation<UploadedFile, ApiError, File>({
    mutationFn: (file) => FileRepository.uploadMenuItemImage(file),
  });
}

/**
 * Client-side pre-flight for the picker.
 *
 * <p>Exists to turn "you waited three seconds to be told no" into an instant message, and for
 * nothing else. It reads {@code File.type}, which the browser derives from the file extension —
 * so renaming {@code payload.exe} to {@code payload.png} passes this check completely. That is
 * fine and expected: file-service reads the actual bytes, and THAT is the control. Never move
 * enforcement here.
 *
 * @returns a human-readable reason to refuse, or null when the file looks acceptable
 */
export function validateMenuImageClientSide(file: File): string | null {
  if (!(MENU_IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "Choose a JPEG, PNG or WebP image.";
  }
  if (file.size > MENU_IMAGE_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `That image is ${mb} MB. The maximum is 2 MB — try a smaller photo.`;
  }
  return null;
}

interface AuthenticatedImage {
  /** Object URL for an `<img src>`, or null while loading / on failure. */
  objectUrl: string | null;
  isLoading: boolean;
  isError: boolean;
}

/**
 * One picture, shared by every component currently asking for it.
 *
 * <p>`refs` is how many mounted components hold this entry. Only a zero-ref entry may be
 * revoked, which is what makes the shared cache safe: an object URL is never pulled out from
 * under an `<img>` that is still on screen.
 */
interface ImageEntry {
  objectUrl: string | null;
  bytes: number;
  failed: boolean;
  settled: boolean;
  refs: number;
  lastUsed: number;
  listeners: Set<() => void>;
}

/**
 * Budget for retained pictures. Menu images are capped at 2 MiB each by file-service, so the
 * byte ceiling — not the count — is what usually binds. Both exist because either one alone
 * lies: 48 tiny thumbnails cost nothing, and six 2 MiB photographs cost more than forty.
 */
const IMAGE_CACHE_MAX_ENTRIES = 48;
const IMAGE_CACHE_MAX_BYTES = 32 * 1024 * 1024;

const imageCache = new Map<string, ImageEntry>();

function totalCachedBytes(): number {
  let total = 0;
  for (const entry of imageCache.values()) total += entry.bytes;
  return total;
}

/** Revokes least-recently-used UNHELD entries until the cache is back inside its budget. */
function trimImageCache(): void {
  if (imageCache.size <= IMAGE_CACHE_MAX_ENTRIES && totalCachedBytes() <= IMAGE_CACHE_MAX_BYTES) {
    return;
  }
  const evictable = Array.from(imageCache.entries())
    .filter(([, e]) => e.refs === 0 && e.settled)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

  for (const [path, entry] of evictable) {
    if (imageCache.size <= IMAGE_CACHE_MAX_ENTRIES && totalCachedBytes() <= IMAGE_CACHE_MAX_BYTES) {
      return;
    }
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    imageCache.delete(path);
  }
}

/** Test seam — a shared module-level cache would otherwise leak state between test files. */
export function __resetAuthenticatedImageCache(): void {
  for (const entry of imageCache.values()) {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  imageCache.clear();
}

/**
 * Renders a permission-gated file as an image.
 *
 * <h2>Why this is not just `<img src={imageUrl}>`</h2>
 *
 * <p>A menu picture is served by {@code GET /api/v1/pos/menu/images/&#123;fileId&#125;}, gated on
 * {@code pos.menu.view}, which means an {@code Authorization} header — and a browser image
 * request does not send one. Pointing an {@code <img>} straight at that path produces a 401 and
 * a broken-image icon on every tile, which reads as "the upload failed" rather than "the request
 * was unauthenticated".
 *
 * <p>So the bytes go through the authenticated client and become an object URL.
 *
 * <h2>Why the cache is shared rather than per-component</h2>
 *
 * <p>This hook used to own one object URL per mounted component, created in an effect and
 * revoked on unmount. Correct, and unusable on a till: the POS grid remounts its tiles on every
 * category tap, so a forty-photograph menu re-fetched, re-decoded and re-blobbed forty images
 * each time the cashier moved between Starters and Mains — mid-service, on a touchscreen.
 *
 * <p>The lifetime is now the CACHE's, refcounted, so switching category and switching back costs
 * nothing and two tiles sharing a picture fetch it once. Revocation still happens — a zero-ref
 * entry is evictable — but it happens when memory is actually needed rather than the instant a
 * component blinks out of existence. {@link trimImageCache} never touches a held entry, so no
 * `<img>` on screen can have its blob revoked underneath it.
 */
export function useAuthenticatedImage(downloadPath: string | null | undefined): AuthenticatedImage {
  // Re-render trigger only. The truth lives in the module cache, so this state deliberately
  // holds nothing — storing a copy of the entry here is how a component ends up rendering an
  // object URL the cache has already replaced.
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!downloadPath) return;

    let entry = imageCache.get(downloadPath);
    if (!entry) {
      entry = {
        objectUrl: null,
        bytes: 0,
        failed: false,
        settled: false,
        refs: 0,
        lastUsed: Date.now(),
        listeners: new Set(),
      };
      imageCache.set(downloadPath, entry);
      const pending = entry;
      FileRepository.fetchBlob(downloadPath)
        .then((blob) => {
          // The entry may have been evicted while the fetch was in flight (nothing held it).
          // Creating an object URL for a cache slot nobody owns any more would leak its blob
          // for the lifetime of the document, so check identity before minting one.
          if (imageCache.get(downloadPath) !== pending) return;
          pending.objectUrl = URL.createObjectURL(blob);
          pending.bytes = blob.size;
          pending.settled = true;
          pending.listeners.forEach((l) => l());
          trimImageCache();
        })
        .catch(() => {
          if (imageCache.get(downloadPath) !== pending) return;
          pending.failed = true;
          pending.settled = true;
          pending.listeners.forEach((l) => l());
        });
    }

    entry.refs += 1;
    entry.lastUsed = Date.now();
    entry.listeners.add(bump);
    // A settled entry produces no further notification, so the subscriber that arrives after the
    // fetch resolved has to read it now — otherwise a tile that mounts second renders a
    // permanent skeleton over an image that is already in memory.
    if (entry.settled) bump();

    const held = entry;
    return () => {
      held.listeners.delete(bump);
      held.refs -= 1;
      held.lastUsed = Date.now();
      trimImageCache();
    };
  }, [downloadPath]);

  if (!downloadPath) {
    return { objectUrl: null, isLoading: false, isError: false };
  }
  const entry = imageCache.get(downloadPath);
  if (!entry || !entry.settled) {
    return { objectUrl: null, isLoading: true, isError: false };
  }
  return { objectUrl: entry.objectUrl, isLoading: false, isError: entry.failed };
}
