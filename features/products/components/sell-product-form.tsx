"use client";

import { ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { sellProductAction } from "@/actions/product.actions";
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
import { cn, formatCurrency } from "@/lib/utils";

const NO_PLAYER_VALUE = "__none__";

interface SellProductFormProduct {
  id: string;
  name: string;
  priceCents: number;
}

interface SellProductFormPlayer {
  id: string;
  label: string;
}

interface SellProductFormPaymentMethod {
  id: string;
  label: string;
}

interface SellProductFormValues {
  productId: string;
  quantity: string;
  paymentMethodId: string;
  playerId: string;
}

interface SellProductFormProps {
  products: SellProductFormProduct[];
  players: SellProductFormPlayer[];
  paymentMethods: SellProductFormPaymentMethod[];
}

export function SellProductForm({ products, players, paymentMethods }: SellProductFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { control, register, handleSubmit, setValue, watch } = useForm<SellProductFormValues>({
    defaultValues: {
      productId: products[0]?.id ?? "",
      quantity: "1",
      paymentMethodId: paymentMethods[0]?.id ?? "",
      playerId: NO_PLAYER_VALUE,
    },
  });
  const watchedProductId = watch("productId");

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const quantity = Number(values.quantity);
    if (!Number.isFinite(quantity) || quantity < 1) {
      setServerError("Enter a valid quantity.");
      return;
    }

    startTransition(async () => {
      const result = await sellProductAction({
        productId: values.productId,
        quantity,
        paymentMethodId: values.paymentMethodId,
        playerId: values.playerId === NO_PLAYER_VALUE ? undefined : values.playerId,
      });
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Sale recorded.");
      router.refresh();
    });
  });

  if (products.length === 0) {
    return <p className="text-muted-foreground text-sm">No products are available for sale.</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Product</Label>
        {/* Tappable buttons instead of a dropdown — same RecordCard-style
            language (icon, label, price) used elsewhere, selected state
            borrowed from the open-play settle panel's own treatment. A
            grid like this reads fine up to ~10-12 items; if the catalog
            grows well past that, this should fall back to a searchable
            dropdown instead of just scrolling forever. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Product">
          {products.map((product) => {
            const selected = watchedProductId === product.id;
            return (
              <button
                key={product.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setValue("productId", product.id)}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-xl border bg-card p-3 text-left transition-colors",
                  selected ? "border-primary/50 bg-primary/[0.04]" : "hover:bg-accent",
                )}
              >
                <ShoppingBag
                  className={cn("size-4", selected ? "text-primary" : "text-muted-foreground")}
                  aria-hidden="true"
                />
                <span className={cn("text-sm", selected ? "font-semibold" : "font-medium")}>{product.name}</span>
                <span className="text-muted-foreground text-xs">{formatCurrency(product.priceCents)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quantity">Quantity</Label>
        <Input id="quantity" type="number" min="1" step="1" {...register("quantity")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="playerId">Player (optional)</Label>
        <Controller
          control={control}
          name="playerId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="playerId" className="w-full">
                <SelectValue placeholder="Walk-in — no player">
                  {(value: string) =>
                    value === NO_PLAYER_VALUE
                      ? "Walk-in — no player"
                      : (players.find((player) => player.id === value)?.label ?? "Walk-in — no player")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PLAYER_VALUE}>Walk-in — no player</SelectItem>
                {players.map((player) => (
                  <SelectItem key={player.id} value={player.id}>
                    {player.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="paymentMethodId">Payment method</Label>
        <Controller
          control={control}
          name="paymentMethodId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="paymentMethodId" className="w-full">
                <SelectValue placeholder="Select a payment method">
                  {(value: string) =>
                    paymentMethods.find((method) => method.id === value)?.label ??
                    "Select a payment method"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {paymentMethods.map((method) => (
                  <SelectItem key={method.id} value={method.id}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Selling…" : "Sell"}
      </Button>
    </form>
  );
}
