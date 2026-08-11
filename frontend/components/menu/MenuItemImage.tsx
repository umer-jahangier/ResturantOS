"use client";

import { ImageOff, ImageIcon } from "lucide-react";

import { useAuthenticatedImage } from "@/lib/hooks/files/use-file-upload";
import { cn } from "@/lib/utils";

interface MenuItemImageProps {
  /** Server-derived download path (`/api/v1/files/{id}/download`), or null for no picture. */
  imageUrl: string | null | undefined;
  /** Item name — used for the alt text, which is what a screen reader actually reads. */
  name: string;
  className?: string;
}

/**
 * Renders a menu item's picture, or a placeholder.
 *
 * <h2>Why this is not a plain `<img src={imageUrl}>`</h2>
 *
 * <p>The download endpoint is gated on {@code file.view}, so it needs an {@code Authorization}
 * header — and a browser image request does not send one. A plain {@code <img>} pointed at that
 * path returns 401 and renders the broken-image glyph, which every user reads as "the upload
 * failed" rather than "that request was unauthenticated". {@code useAuthenticatedImage} fetches
 * the bytes through the authenticated client and hands back an object URL.
 *
 * <h2>Three states, not two</h2>
 *
 * <p>NO IMAGE and FAILED TO LOAD are deliberately different. An item that has no picture is
 * normal and gets a calm placeholder; an item whose picture would not load is a problem and says
 * so. Collapsing them would make a broken image indistinguishable from a missing one — the same
 * "empty state that is really an error" defect GA-001 catalogued across eleven list screens.
 */
export function MenuItemImage({ imageUrl, name, className }: MenuItemImageProps) {
  const { objectUrl, isLoading, isError } = useAuthenticatedImage(imageUrl);

  const frame = cn(
    "flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted",
    className,
  );

  if (!imageUrl) {
    return (
      <div className={frame} data-testid="menu-item-image-placeholder" aria-hidden="true">
        <ImageIcon className="size-4 text-muted-foreground" />
      </div>
    );
  }

  if (isLoading) {
    return <div className={cn(frame, "animate-pulse")} aria-hidden="true" />;
  }

  if (isError || !objectUrl) {
    return (
      <div
        className={frame}
        data-testid="menu-item-image-error"
        role="img"
        aria-label={`${name} — picture could not be loaded`}
        title="Picture could not be loaded"
      >
        <ImageOff className="size-4 text-muted-foreground" />
      </div>
    );
  }

  // next/image cannot carry an Authorization header, and the source here is a `blob:` object URL
  // created from an authenticated fetch — which its loader and optimizer cannot process either.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={objectUrl}
      alt={name}
      data-testid="menu-item-image"
      className={cn(frame, "object-cover")}
    />
  );
}
