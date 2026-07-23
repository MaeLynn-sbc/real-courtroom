"use client";

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
import { formatCurrency } from "@/lib/utils";

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

  const { control, register, handleSubmit } = useForm<SellProductFormValues>({
    defaultValues: {
      productId: products[0]?.id ?? "",
      quantity: "1",
      paymentMethodId: paymentMethods[0]?.id ?? "",
      playerId: NO_PLAYER_VALUE,
    },
  });

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
        <Label htmlFor="productId">Product</Label>
        <Controller
          control={control}
          name="productId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="productId" className="w-full">
                <SelectValue placeholder="Select a product">
                  {(value: string) => {
                    const product = products.find((item) => item.id === value);
                    return product ? `${product.name} — ${formatCurrency(product.priceCents)}` : "Select a product";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} — {formatCurrency(product.priceCents)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
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
