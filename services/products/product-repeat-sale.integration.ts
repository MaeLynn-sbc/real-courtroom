/**
 * Sale.productId was mistakenly @unique (migration
 * 29_sale_product_id_not_unique) — copy-pasted from the other Sale
 * back-reference fields (bookingId, membershipId, etc.), which
 * correctly point at one-time transaction rows. productId instead
 * points at the reusable Product catalog row itself
 * (productService.sellProduct sets it to the same catalog id every
 * time), so the unique constraint made it impossible to ever sell the
 * same retail item twice. Proven failing pre-fix: a second sale of an
 * already-sold product threw a real Prisma unique-constraint
 * violation.
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
      data: { shiftNumber: `SHIFT-PRODREPEAT-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }

  await prisma.sale.deleteMany({ where: { productId: product.id } });

  const saleContext = { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cash.id };

  const sale1 = await productService.sellProduct({ productId: product.id, quantity: 1, paymentMethodId: cash.id }, owner.id, saleContext);
  console.log(`First sale of "${product.name}" succeeded: ${sale1.saleNumber}`);

  const sale2 = await productService.sellProduct({ productId: product.id, quantity: 1, paymentMethodId: cash.id }, owner.id, saleContext);
  console.log(`Second sale of the SAME product succeeded: ${sale2.saleNumber}`);
  assert(sale2.id !== sale1.id, "expected a distinct second Sale row, not the first one reused");

  const sale3 = await productService.sellProduct({ productId: product.id, quantity: 3, paymentMethodId: cash.id }, owner.id, saleContext);
  console.log(`Third sale of the SAME product succeeded: ${sale3.saleNumber}, amount=${sale3.amountCents}`);
  assert(sale3.amountCents === product.priceCents * 3, `expected quantity to scale the amount, got ${sale3.amountCents}`);

  const count = await prisma.sale.count({ where: { productId: product.id } });
  assert(count === 3, `expected 3 separate Sale rows for the same product, got ${count}`);

  await prisma.sale.deleteMany({ where: { productId: product.id } });
  console.log(`PASS: the same product can be sold repeatedly — ${count} separate Sale rows created, no unique-constraint collision.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
