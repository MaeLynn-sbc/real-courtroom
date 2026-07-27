"use client";

import { GripVertical, ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createProductAction,
  reorderProductsAction,
  updateProductAction,
} from "@/actions/product.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RecordCard, recordCardAccentButtonClass } from "@/components/ui/record-card";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/utils";
import type { productService } from "@/services/products/product.service";

type Products = Awaited<ReturnType<typeof productService.listProducts>>;

// Unlike payment methods (a fixed CASH/GCASH/BANK_TRANSFER/... key),
// Product has no type/category field to key an icon+ramp lookup off —
// any staff member can add anything for sale (paddles, drinks, shirts,
// grip tape). Rather than guess at names or cycle colors arbitrarily
// (both fail "meaningful, not arbitrary"), every product card uses one
// consistent, deliberately-chosen identity: a generic retail icon on
// "cyan" — BUILD-SPEC.md §2's ramp table already listed cyan as
// "Reserved — not yet assigned to a record type," making this its first
// real assignment, not an arbitrary pick. A record's own name (the card
// title) carries the per-item identity instead.
const PRODUCT_ICON = ShoppingBag;
const PRODUCT_RAMP = "cyan" as const;

function AddProductForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stockCount, setStockCount] = useState("0");

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const priceCents = Math.round(Number(price) * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setServerError("Enter a valid price.");
      return;
    }
    const stock = Number(stockCount);
    if (!Number.isFinite(stock) || stock < 0) {
      setServerError("Enter a valid starting stock count.");
      return;
    }

    startTransition(async () => {
      const result = await createProductAction({ name, priceCents, stockCount: stock });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Product added.");
      setName("");
      setPrice("");
      setStockCount("0");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a product</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="productName">Name</Label>
              <Input id="productName" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="productPrice">Price (₱)</Label>
              <Input
                id="productPrice"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="productStock">Starting stock</Label>
              <Input
                id="productStock"
                type="number"
                min="0"
                step="1"
                value={stockCount}
                onChange={(event) => setStockCount(event.target.value)}
              />
            </div>
          </div>
          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Adding…" : "Add product"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ProductRow({
  product,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  product: Products[number];
  draggable: boolean;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState((product.priceCents / 100).toFixed(2));
  const [active, setActive] = useState(product.active);
  const [stockCount, setStockCount] = useState(String(product.stockCount));
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const priceCents = Math.round(Number(price) * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      toast.error("Enter a valid price.");
      return;
    }
    const stock = Number(stockCount);
    if (!Number.isFinite(stock) || stock < 0) {
      toast.error("Enter a valid stock count.");
      return;
    }

    startTransition(async () => {
      const result = await updateProductAction(product.id, {
        name,
        priceCents,
        active,
        stockCount: stock,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Product saved.");
      router.refresh();
    });
  }

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-product-name={product.name}
      className="flex items-center gap-2"
    >
      <GripVertical
        className="text-muted-foreground size-4 shrink-0 cursor-grab active:cursor-grabbing"
        aria-hidden="true"
      />
      <RecordCard
        ramp={PRODUCT_RAMP}
        icon={PRODUCT_ICON}
        title={product.name}
        active={product.active}
        density="compact"
        className="flex-1"
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <Input value={name} onChange={(event) => setName(event.target.value)} className="flex-1" />
            <div className="flex flex-col gap-1">
              <Label htmlFor={`price-${product.id}`} className="text-muted-foreground text-[11px]">
                Price (₱)
              </Label>
              <Input
                id={`price-${product.id}`}
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                className="w-24"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`stock-${product.id}`} className="text-muted-foreground text-[11px]">
                Stock
              </Label>
              <Input
                id={`stock-${product.id}`}
                type="number"
                min="0"
                step="1"
                value={stockCount}
                onChange={(event) => setStockCount(event.target.value)}
                className="w-20"
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={handleSave}
              className={recordCardAccentButtonClass(PRODUCT_RAMP)}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {formatCurrency(product.priceCents)} · {product.stockCount} in stock
          </p>
          {/* The header pill (RecordCard) shows current state; this is the
              actual control that changes it — same split as payment-methods'
              own row. */}
          <div className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} aria-label={`${product.name} active`} />
            <span className="text-muted-foreground text-xs">
              {active ? "Active — tap to disable" : "Disabled — tap to enable"}
            </span>
          </div>
        </div>
      </RecordCard>
    </div>
  );
}

export function ProductCatalog({ products }: { products: Products }) {
  const router = useRouter();
  const [orderedProducts, setOrderedProducts] = useState(products);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Re-sync when the server component re-fetches after a save/reorder —
  // otherwise this local copy would go stale on the next router.refresh().
  useEffect(() => {
    setOrderedProducts(products);
  }, [products]);

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }

    const next = [...orderedProducts];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    setOrderedProducts(next);
    setDragIndex(null);

    reorderProductsAction({ orderedIds: next.map((product) => product.id) })
      .then((result) => {
        if (result.error) {
          toast.error(result.error);
          return;
        }
        router.refresh();
      })
      .catch(() => toast.error("Failed to reorder products."));
  }

  return (
    <div className="flex flex-col gap-6">
      <AddProductForm />

      {orderedProducts.length === 0 ? (
        <p className="text-muted-foreground text-sm">No products yet — add one above.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {orderedProducts.map((product, index) => (
            <ProductRow
              key={product.id}
              product={product}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
