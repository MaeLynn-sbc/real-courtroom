import { calculateEquipmentCondition } from "@/services/equipment/equipment-condition";

describe("calculateEquipmentCondition", () => {
  it("returns RETIRED regardless of quantity or damage", () => {
    expect(
      calculateEquipmentCondition({
        status: "RETIRED",
        availableQuantity: 5,
        hasUnresolvedDamageReport: true,
      }),
    ).toBe("RETIRED");
  });

  it("returns MAINTENANCE when the whole line is pulled", () => {
    expect(
      calculateEquipmentCondition({
        status: "MAINTENANCE",
        availableQuantity: 5,
        hasUnresolvedDamageReport: false,
      }),
    ).toBe("MAINTENANCE");
  });

  it("returns DAMAGED only when nothing is available AND damage is unresolved", () => {
    expect(
      calculateEquipmentCondition({
        status: "AVAILABLE",
        availableQuantity: 0,
        hasUnresolvedDamageReport: true,
      }),
    ).toBe("DAMAGED");
  });

  it("returns RENTED when nothing is available and there's no damage", () => {
    expect(
      calculateEquipmentCondition({
        status: "AVAILABLE",
        availableQuantity: 0,
        hasUnresolvedDamageReport: false,
      }),
    ).toBe("RENTED");
  });

  it("returns AVAILABLE when stock remains, even with an unresolved damage report on a different unit", () => {
    expect(
      calculateEquipmentCondition({
        status: "AVAILABLE",
        availableQuantity: 3,
        hasUnresolvedDamageReport: true,
      }),
    ).toBe("AVAILABLE");
  });
});
