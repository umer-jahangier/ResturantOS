"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImageIcon, Upload, X } from "lucide-react";

import {
  useUploadMenuItemImage,
  validateMenuImageClientSide,
} from "@/lib/hooks/files/use-file-upload";
import { MenuItemImage } from "@/components/menu/MenuItemImage";
import { Button } from "@/components/ui/button";
import { FieldHelp } from "@/components/shared/field-help";

interface MenuItemImageFieldProps {
  /** Currently selected file id (`null` = no picture). Controlled by the parent form. */
  value: string | null;
  /** Server-derived URL for the CURRENT value — used to preview an already-saved picture. */
  currentImageUrl: string | null;
  onChange: (fileId: string | null, previewUrl: string | null) => void;
  disabled?: boolean;
}

/**
 * The product's first file input, so it sets the pattern for every one after it.
 *
 * <h2>Upload happens on select, not on submit</h2>
 *
 * <p>The file goes to file-service the moment it is chosen, and the form then carries only the
 * returned {@code fileId}. The alternative — hold the {@code File} in form state and upload
 * during submit — means the menu-item save and the upload can fail independently, and the user
 * discovers a rejected image only after committing to the whole form. Uploading first makes
 * "that is not a valid image" a fast, local answer, and makes the save a plain JSON write.
 *
 * <p>The cost is an orphan: a file uploaded and then abandoned by cancelling the dialog. That is
 * accepted, and it is bounded — the upload is quota-checked and capped at 2 MiB, and a replaced
 * image IS released by pos-service when the item is saved. Cleaning up abandoned uploads is a
 * sweeper's job, not a form's.
 *
 * <h2>The client-side check is a courtesy</h2>
 *
 * <p>{@code validateMenuImageClientSide} reads {@code File.type}, which the browser derives from
 * the extension — renaming a file defeats it entirely. It exists so the common mistake gets an
 * instant answer. file-service reads the actual magic bytes and enforces the cap server-side,
 * and that is the control. Anyone can POST to the gateway directly.
 */
export function MenuItemImageField({
  value,
  currentImageUrl,
  onChange,
  disabled,
}: MenuItemImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const upload = useUploadMenuItemImage();
  const [error, setError] = useState<string | null>(null);
  /** Local object URL for a just-picked file, so the preview appears before any round trip. */
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  // An object URL pins its blob for the document's lifetime; revoke on unmount or replacement.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);

    const clientSideReason = validateMenuImageClientSide(file);
    if (clientSideReason) {
      setError(clientSideReason);
      // Clear the input so picking the SAME file again still fires a change event.
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    // Preview OPTIMISTICALLY, before the upload resolves. A 2 MB photo over a restaurant's wifi
    // is a visible wait, and showing nothing but "Uploading…" for it reads as "my click did not
    // register" — the user picks the file again. The revoke is handled by the effect above,
    // which fires whenever `localPreview` changes or the component unmounts, so this is the only
    // place an object URL is created and nothing has to remember to release it.
    const preview = URL.createObjectURL(file);
    setLocalPreview(preview);

    upload.mutate(file, {
      onSuccess: (uploaded) => onChange(uploaded.fileId, preview),
      onError: (apiError) => {
        // Roll the optimistic preview back — leaving it would show a picture that is not stored
        // anywhere, and the next save would silently drop it.
        setLocalPreview(null);
        // file-service answers 422 with a sentence written for a person — "That file is not a
        // JPEG, PNG or WebP image", "Image is 4.2 MB. The maximum is 2.0 MB". Show it.
        setError(apiError.message || "Could not upload that image. Please try again.");
      },
      onSettled: () => {
        if (inputRef.current) inputRef.current.value = "";
      },
    });
  }

  function handleRemove() {
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(null);
    setError(null);
    onChange(null, null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const hasImage = value !== null;
  const isBusy = upload.isPending || disabled;

  return (
    <div className="grid gap-2">
      {/* A plain <label> + FieldHelp rather than <FieldLabel>. FieldLabel wraps FormLabel, which
          reads react-hook-form's field context — and this control is deliberately NOT a
          react-hook-form field (the upload has already happened; what remains is an id). Using
          it here throws "Cannot destructure property 'getFieldState' of useFormContext(...) as
          it is null" the moment the component is rendered outside a <FormField>. The htmlFor
          binding is also the better outcome: the visible label names the real file input. */}
      <div className="flex items-center gap-1.5">
        <label
          htmlFor={inputId}
          className="flex items-center gap-2 text-sm font-medium leading-none"
        >
          Picture
        </label>
        <FieldHelp label="Picture">
          Optional. JPEG, PNG or WebP, up to 2 MB. Shown wherever the item appears with a
          picture.
        </FieldHelp>
      </div>

      <div className="flex items-start gap-3">
        {/* Preview. A freshly-picked file previews from its local object URL (instant, no round
            trip); an already-saved one goes through MenuItemImage, which fetches it with the
            Authorization header the download endpoint requires. */}
        {/* `blob:` object URL — next/image cannot process one, and has no way to send the
            Authorization header the download endpoint requires. */}
        {localPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={localPreview}
            alt="Selected picture preview"
            data-testid="menu-item-image-preview"
            className="size-20 shrink-0 rounded-md border object-cover"
          />
        ) : hasImage ? (
          <MenuItemImage imageUrl={currentImageUrl} name="Current picture" className="size-20" />
        ) : (
          <div
            className="flex size-20 shrink-0 items-center justify-center rounded-md border border-dashed bg-muted"
            data-testid="menu-item-image-empty"
            aria-hidden="true"
          >
            <ImageIcon className="size-6 text-muted-foreground" />
          </div>
        )}

        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
              data-testid="menu-item-image-choose"
            >
              <Upload className="size-4" />
              {upload.isPending ? "Uploading…" : hasImage ? "Replace" : "Upload picture"}
            </Button>
            {hasImage ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isBusy}
                onClick={handleRemove}
                data-testid="menu-item-image-remove"
              >
                <X className="size-4" />
                Remove
              </Button>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            JPEG, PNG or WebP · up to 2 MB
          </p>

          {error ? (
            <p role="alert" data-testid="menu-item-image-error-message" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      {/* The actual input is visually hidden but focusable via the button above, so the control
          keeps native file-picker behaviour (including keyboard) without the unstyleable
          default widget. `accept` filters the OS dialog — it is a convenience, not a check. */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        className="sr-only"
        data-testid="menu-item-image-input"
        onChange={(e) => handleFile(e.target.files?.[0])}
        disabled={isBusy}
      />
    </div>
  );
}
