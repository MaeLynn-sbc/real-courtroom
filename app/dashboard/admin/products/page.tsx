import type { Metadata } from "next";

import { ProductCatalog } from "@/features/products/components/product-catalog";
import { productService } from "@/services/products/product.service";

export const metadata: Metadata = {
  title: "Shop Catalog",
};

export const dynamic = "force-dynamic";

export default async function ProductCatalogPage() {
  const products = await productService.listProducts();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shop Catalog</h1>
        <p className="text-muted-foreground text-sm">
          Retail items sold outright (balls, T-shirts, etc.) — drag to reorder, edit price, or turn a
          product off without deleting it.
        </p>
      </div>

      <ProductCatalog products={products} />
    </div>
  );
}
