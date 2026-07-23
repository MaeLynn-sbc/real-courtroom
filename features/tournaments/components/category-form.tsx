"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createCategoryAction } from "@/actions/tournament.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCategorySchema } from "@/features/tournaments/schemas/tournament.schema";

const FORMAT_OPTIONS = [
  { value: "ROUND_ROBIN", label: "Round Robin" },
  { value: "SINGLE_ELIMINATION", label: "Single Elimination" },
] as const;

const DIVISION_OPTIONS = [
  { value: "MENS", label: "Men's" },
  { value: "WOMENS", label: "Women's" },
  { value: "MIXED", label: "Mixed" },
  { value: "OPEN", label: "Open" },
] as const;

interface CategoryFormValues {
  name: string;
  format: (typeof FORMAT_OPTIONS)[number]["value"];
  division: (typeof DIVISION_OPTIONS)[number]["value"];
  maxTeams: string;
}

interface CategoryFormProps {
  tournamentId: string;
}

export function CategoryForm({ tournamentId }: CategoryFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    defaultValues: { name: "", format: "ROUND_ROBIN", division: "OPEN", maxTeams: "" },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = createCategorySchema.safeParse({
      name: values.name.trim(),
      format: values.format,
      division: values.division,
      maxTeams: values.maxTeams.trim() || undefined,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid category details.");
      return;
    }

    startTransition(async () => {
      const result = await createCategoryAction(tournamentId, parsed.data);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Category added.");
      reset();
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="categoryName">Name</Label>
        <Input id="categoryName" placeholder="e.g. Men's Singles" {...register("name")} />
        {errors.name ? <p className="text-destructive text-sm">{errors.name.message}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="division">Division</Label>
        <Controller
          control={control}
          name="division"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="division" className="w-full">
                <SelectValue>
                  {(value: string) =>
                    DIVISION_OPTIONS.find((option) => option.value === value)?.label ?? value
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DIVISION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="format">Format</Label>
        <Controller
          control={control}
          name="format"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="format" className="w-full">
                <SelectValue>
                  {(value: string) =>
                    FORMAT_OPTIONS.find((option) => option.value === value)?.label ?? value
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="maxTeams">Max teams (optional)</Label>
        <Input id="maxTeams" type="number" min={2} {...register("maxTeams")} />
      </div>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending} size="sm">
        {isPending ? "Adding…" : "Add category"}
      </Button>
    </form>
  );
}
