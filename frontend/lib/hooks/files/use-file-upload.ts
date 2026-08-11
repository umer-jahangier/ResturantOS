"use client";

import { useEffect, useState } from "react";
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
 * Renders a permission-gated file as an image.
 *
 * <h2>Why this is not just `<img src={imageUrl}>`</h2>
 *
 * <p>{@code GET /api/v1/files/{id}/download} requires {@code file.view}, which means an
 * {@code Authorization} header — and a browser image request does not send one. Pointing an
 * {@code <img>} straight at that path produces a 401 and a broken-image icon on every menu row,
 * which reads as "the upload failed" rather than "the request was unauthenticated".
 *
 * <p>So the bytes go through the authenticated client and become an object URL.
 *
 * <h2>Why this uses useState/useEffect rather than useQuery</h2>
 *
 * <p>An object URL is a resource with an explicit lifetime, not a cacheable value: it pins its
 * blob in memory until {@link URL.revokeObjectURL} is called. Caching one in the query client
 * would hand out a URL whose blob may already have been revoked by an unmount elsewhere, and
 * caching one WITHOUT revoking leaks every image the user has ever scrolled past. Tying
 * creation and revocation to a single effect makes the lifetime exactly the component's.
 */
/** What the last completed fetch produced, tagged with the path it was for. */
interface ResolvedImage {
  path: string;
  objectUrl: string | null;
  failed: boolean;
}

export function useAuthenticatedImage(downloadPath: string | null | undefined): AuthenticatedImage {
  // ONE state, written only from async callbacks — never synchronously in the effect body.
  // Loading is DERIVED (below) from "the resolved path is not the one being asked for" rather
  // than stored, which is why no setState is needed to enter the loading state. That also makes
  // the state machine unrepresentable-in-the-wrong-way: there is no ordering of setters that
  // can leave `isLoading` true forever or show a stale image as if it were the current one.
  const [resolved, setResolved] = useState<ResolvedImage | null>(null);

  useEffect(() => {
    if (!downloadPath) return;

    let created: string | null = null;
    // Guards the out-of-order resolve: if `downloadPath` changes while a fetch is in flight, the
    // stale response must not overwrite the newer image — nor leak its blob.
    let cancelled = false;

    FileRepository.fetchObjectUrl(downloadPath)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setResolved({ path: downloadPath, objectUrl: url, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResolved({ path: downloadPath, objectUrl: null, failed: true });
      });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [downloadPath]);

  if (!downloadPath) {
    return { objectUrl: null, isLoading: false, isError: false };
  }
  // Only trust `resolved` when it belongs to the path currently being asked for.
  const isCurrent = resolved?.path === downloadPath;
  if (!isCurrent) {
    return { objectUrl: null, isLoading: true, isError: false };
  }
  return {
    objectUrl: resolved.objectUrl,
    isLoading: false,
    isError: resolved.failed,
  };
}
