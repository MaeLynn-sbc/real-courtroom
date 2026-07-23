"use client";

import { GripVertical } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import type { productService } from "@/services/products/product.service";

type Products = Awaited<ReturnType<typeof productService.listProducts>>;

function AddProductForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [priceCents, setPriceCents] = useState("");

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    startTransition(async () => {
      const result = await createProductAction({ name, priceCents: Number(priceCents) });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Product added.");
      setName("");
      setPriceCents("");
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
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="productName">Name</Label>
              <Input id="productName" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="productPrice">Price (cents)</Label>
              <Input
                id="productPrice"
                type="number"
                min="0"
                value={priceCents}
                onChange={(event) => setPriceCents(event.target.value)}
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
  const [priceCents, setPriceCents] = useState(String(product.priceCents));
  const [active, setActive] = useState(product.active);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await updateProductAction(product.id, {
        name,
        priceCents: Number(priceCents),
        active,
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
      className="bg-card flex items-center gap-3 rounded-xl border p-3"
    >
      <GripVertical
        className="text-muted-foreground size-4 shrink-0 cursor-grab active:cursor-grabbing"
        aria-hidden="true"
      />
      <Input value={name} onChange={(event) => setName(event.target.value)} className="flex-1" />
      <Input
        type="number"
        min="0"
        value={priceCents}
        onChange={(event) => setPriceCents(event.target.value)}
        className="w-32"
      />
      <div className="flex items-center gap-2">
        <Switch checked={active} onCheckedChange={setActive} aria-label={`${product.name} active`} />
        <span className="text-muted-foreground text-xs">{active ? "Active" : "Inactive"}</span>
      </div>
      <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleSave}>
        {isPending ? "Saving…" : "Save"}
      </Button>
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
