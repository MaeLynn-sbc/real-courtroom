"use client";

import { GripVertical, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  reorderGalleryImagesAction,
  removeGalleryImageAction,
  uploadGalleryImageAction,
} from "@/actions/cms.actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GalleryImage } from "@/features/cms/schemas/cms.schema";
import { cn } from "@/lib/utils";

export function GalleryPanel({ images }: { images: GalleryImage[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [orderedImages, setOrderedImages] = useState(images);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [isUploading, startUploadTransition] = useTransition();
  const [isPending, startTransition] = useTransition();
  // Display-only — the actual submission still reads the real, uncontrolled
  // <input name="file"> via the form action's FormData, unchanged.
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  useEffect(() => {
    setOrderedImages(images);
  }, [images]);

  function handleUpload(formData: FormData) {
    startUploadTransition(async () => {
      const result = await uploadGalleryImageAction(formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Image uploaded.");
      formRef.current?.reset();
      setSelectedFileName(null);
      router.refresh();
    });
  }

  function handleRemove(url: string) {
    startTransition(async () => {
      const result = await removeGalleryImageAction(url);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Image removed.");
      router.refresh();
    });
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }

    const next = [...orderedImages];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    setOrderedImages(next);
    setDragIndex(null);

    startTransition(async () => {
      const result = await reorderGalleryImagesAction(next);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gallery</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Same treatment as this app's other file inputs, for consistency
            — this one never had the native-chrome contrast risk (no
            file:text-foreground override to fight it), but every file
            input should look and behave the same way. */}
        <form ref={formRef} action={handleUpload} className="flex items-center gap-3">
          <label htmlFor="galleryFile" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "cursor-pointer")}>
            Choose file
          </label>
          <span className="text-muted-foreground truncate text-sm">
            {selectedFileName ?? "No file selected"}
          </span>
          <input
            id="galleryFile"
            type="file"
            name="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            required
            className="sr-only"
            onChange={(event) => setSelectedFileName(event.target.files?.[0]?.name ?? null)}
          />
          <Button type="submit" size="sm" disabled={isUploading}>
            {isUploading ? "Uploading…" : "Upload"}
          </Button>
        </form>

        {orderedImages.length === 0 ? (
          <p className="text-muted-foreground text-sm">No images yet — upload one above.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {orderedImages.map((image, index) => (
              <div
                key={image.url}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => handleDrop(index)}
                // text-card-foreground alongside bg-card — see the
                // identical fix in product-catalog.tsx's ProductRow.
                // Nothing here reads inherited text color today, but the
                // same trap (invisible text on this white row) is one
                // careless future addition away without it.
                className="bg-card text-card-foreground relative flex flex-col gap-1 rounded-xl border p-2"
              >
                <div className="flex items-center justify-between">
                  <GripVertical
                    className="text-muted-foreground size-4 cursor-grab active:cursor-grabbing"
                    aria-hidden="true"
                  />
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => handleRemove(image.url)}
                    aria-label="Remove image"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <div className="relative aspect-video w-full overflow-hidden rounded-lg">
                  <Image src={image.url} alt={image.alt || "Gallery image"} fill className="object-cover" />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
