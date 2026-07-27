/**
 * Product.stockCount (migration 30_product_stock_count) — a sale
 * decrements stock, and selling past available stock must be rejected
 * with a clear error, never a silent negative count or a Sale row that
 * outstrips what was actually in stock.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { productService } from "./product.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const cash = await prisma.paymentMethod.findFirstOrThrow({ where: { key: "CASH" } });
  const product = await prisma.product.findFirstOrThrow({ where: { active: true } });

  let shift = await prisma.shift.findFirst({ where: { employeeId: ownerEmployee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-STOCKGUARD-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }

  await prisma.sale.deleteMany({ where: { productId: product.id } });
  const originalStockCount = product.stockCount;
  await prisma.product.update({ where: { id: product.id }, data: { stockCount: 3 } });

  const saleContext = { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cash.id };

  await productService.sellProduct({ productId: product.id, quantity: 2, paymentMethodId: cash.id }, owner.id, saleContext);
  const afterFirstSale = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  console.log(`Sold 2 of 3 — stock now ${afterFirstSale.stockCount}`);
  assert(afterFirstSale.stockCount === 1, `expected stock to decrement to 1, got ${afterFirstSale.stockCount}`);

  console.log("Attempting to sell 2 more (only 1 left) — expected to fail...");
  let rejected = false;
  try {
    await productService.sellProduct({ productId: product.id, quantity: 2, paymentMethodId: cash.id }, owner.id, saleContext);
  } catch (error) {
    rejected = true;
    console.log(`REJECTED as expected: ${error instanceof Error ? error.message : error}`);
    assert(
      error instanceof Error && /not enough stock/i.test(error.message),
      `expected a clear "not enough stock" message, got: ${error instanceof Error ? error.message : error}`,
    );
  }
  assert(rejected, "expected overselling past available stock to be rejected, not silently succeed");

  const afterFailedSale = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(
    afterFailedSale.stockCount === 1,
    `expected stock to stay at 1 (no partial decrement) after the rejected sale, got ${afterFailedSale.stockCount}`,
  );
  assert(afterFailedSale.stockCount >= 0, "stock must never go negative");

  const saleCount = await prisma.sale.count({ where: { productId: product.id } });
  assert(saleCount === 1, `expected only the first (successful) sale to have created a Sale row, got ${saleCount}`);

  console.log("Selling exactly the remaining stock (1) — expected to succeed...");
  await productService.sellProduct({ productId: product.id, quantity: 1, paymentMethodId: cash.id }, owner.id, saleContext);
  const afterFinalSale = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(afterFinalSale.stockCount === 0, `expected stock to reach exactly 0, got ${afterFinalSale.stockCount}`);

  await prisma.sale.deleteMany({ where: { productId: product.id } });
  await prisma.product.update({ where: { id: product.id }, data: { stockCount: originalStockCount } });
  console.log("PASS: sales decrement stock correctly, overselling is rejected with a clear message, stock never goes negative.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
