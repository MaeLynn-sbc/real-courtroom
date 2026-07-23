import type { Metadata } from "next";

import { SellProductForm } from "@/features/products/components/sell-product-form";
import { playerService } from "@/services/player/player.service";
import { productService } from "@/services/products/product.service";
import { saleService } from "@/services/sales/sale.service";

export const metadata: Metadata = {
  title: "Products",
};

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const [products, players, paymentMethods] = await Promise.all([
    productService.listActiveProducts(),
    playerService.listPlayers(),
    saleService.listPaymentMethods(),
  ]);

  const productOptions = products.map((product) => ({
    id: product.id,
    name: product.name,
    priceCents: product.priceCents,
  }));

  const playerOptions = players.map((player) => ({
    id: player.id,
    label: player.user.name ?? player.user.email ?? "Unknown player",
  }));

  const paymentMethodOptions = paymentMethods.map((method) => ({
    id: method.id,
    label: method.label,
  }));

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <p className="text-muted-foreground text-sm">Sell a retail item — balls, T-shirts, and more.</p>
      </div>
      <SellProductForm
        products={productOptions}
        players={playerOptions}
        paymentMethods={paymentMethodOptions}
      />
    </div>
  );
}
