import type { Metadata } from "next";

import { auth } from "@/auth";
import { RecentProductSalesList } from "@/features/products/components/recent-product-sales-list";
import { SellProductForm } from "@/features/products/components/sell-product-form";
import { hasPermission } from "@/lib/rbac";
import { playerService } from "@/services/player/player.service";
import { productService } from "@/services/products/product.service";
import { saleService } from "@/services/sales/sale.service";
import { PERMISSIONS } from "@/types/permissions";

export const metadata: Metadata = {
  title: "Shop",
};

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const session = await auth();
  const canVoidSale = hasPermission(session?.user.permissions ?? [], PERMISSIONS.ACCOUNTS_VOID_SALE);

  const [products, players, paymentMethods, recentSales] = await Promise.all([
    productService.listActiveProducts(),
    playerService.listPlayers(),
    saleService.listPaymentMethods(),
    saleService.listRecentProductSales(),
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
        <h1 className="text-2xl font-semibold tracking-tight">Shop</h1>
        <p className="text-muted-foreground text-sm">Sell a retail item — balls, T-shirts, and more.</p>
      </div>
      <SellProductForm
        products={productOptions}
        players={playerOptions}
        paymentMethods={paymentMethodOptions}
      />
      <RecentProductSalesList
        canVoidSale={canVoidSale}
        sales={recentSales.map((sale) => ({
          id: sale.id,
          productName: sale.product?.name ?? sale.description ?? "Item",
          amountCents: sale.amountCents,
          employeeName: `${sale.employee.firstName} ${sale.employee.lastName}`,
          paymentMethodLabel: sale.paymentMethod.label,
          status: sale.status,
          createdAt: sale.createdAt.toISOString(),
          voidReason: sale.voidReason,
          voidedByEmployeeName: sale.voidedByEmployee
            ? `${sale.voidedByEmployee.firstName} ${sale.voidedByEmployee.lastName}`
            : null,
        }))}
      />
    </div>
  );
}
