"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setHomepageHeroAction } from "@/actions/cms.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { GalleryImage, HomepageHero } from "@/features/cms/schemas/cms.schema";

const NO_IMAGE_VALUE = "__none__";

export function HeroPanel({ hero, galleryImages }: { hero: HomepageHero; galleryImages: GalleryImage[] }) {
  const router = useRouter();
  const [title, setTitle] = useState(hero.title);
  const [subtitle, setSubtitle] = useState(hero.subtitle);
  const [ctaText, setCtaText] = useState(hero.ctaText);
  const [imageUrl, setImageUrl] = useState(hero.imageUrl ?? NO_IMAGE_VALUE);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await setHomepageHeroAction({
        title,
        subtitle,
        ctaText,
        imageUrl: imageUrl === NO_IMAGE_VALUE ? null : imageUrl,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Homepage hero saved.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Homepage hero</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="heroTitle">Hero title</Label>
          <Input id="heroTitle" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="heroSubtitle">Hero subtitle</Label>
          <Textarea
            id="heroSubtitle"
            rows={2}
            value={subtitle}
            onChange={(event) => setSubtitle(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="heroCta">CTA button text</Label>
          <Input id="heroCta" value={ctaText} onChange={(event) => setCtaText(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="heroImage">Hero image</Label>
          <Select value={imageUrl} onValueChange={(value) => setImageUrl(value ?? NO_IMAGE_VALUE)}>
            <SelectTrigger id="heroImage" className="w-full">
              <SelectValue placeholder="No image">
                {(value: string) => (value === NO_IMAGE_VALUE ? "No image" : value)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_IMAGE_VALUE}>No image</SelectItem>
              {galleryImages.map((image) => (
                <SelectItem key={image.url} value={image.url}>
                  {image.alt || image.url}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {galleryImages.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Upload an image in the Gallery panel below to make it available here.
            </p>
          ) : null}
        </div>
        <Button type="button" size="sm" disabled={isPending} onClick={handleSave} className="self-start">
          {isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
