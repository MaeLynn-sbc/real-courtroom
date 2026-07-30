import { act, fireEvent, render, screen } from "@testing-library/react";

import { ProductCatalog } from "./product-catalog";
import { updateProductAction } from "@/actions/product.actions";

jest.mock("@/actions/product.actions", () => ({
  createProductAction: jest.fn(),
  reorderProductsAction: jest.fn(),
  updateProductAction: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const mockedUpdateProduct = updateProductAction as jest.MockedFunction<typeof updateProductAction>;

const product = {
  id: "product-1",
  name: "Pickleballs",
  priceCents: 15000,
  active: true,
  stockCount: 0,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Base UI's Switch (like its Select) only commits a click when a real
// pointerdown preceded it in the browser — jsdom's synthetic click alone
// doesn't satisfy that, so it's fired first here, same fix already used
// for this app's Select components.
async function toggleSwitchAsync(element: Element) {
  await act(async () => {
    fireEvent.pointerDown(element, { pointerType: "mouse" });
    fireEvent.click(element);
  });
}

// Reported live: tapping the Active switch flipped its own label ("Active —
// tap to disable") immediately, making it look saved, but nothing actually
// persisted until the separate Save button (up in the name/price/stock row)
// was also clicked. A product disabled this way came back on the next load.
// Proves the switch now saves on its own, using the product's last-saved
// name/price/stock rather than whatever's sitting unsaved in those fields —
// and that the header pill can never show a different state than the switch.
describe("ProductCatalog — Active toggle persists immediately", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls updateProductAction as soon as the switch is toggled, without touching Save", async () => {
    mockedUpdateProduct.mockResolvedValue({ error: null });

    render(<ProductCatalog products={[product]} />);

    expect(screen.getByText("Active")).toBeInTheDocument();
    await toggleSwitchAsync(screen.getByRole("switch", { name: /pickleballs active/i }));

    expect(mockedUpdateProduct).toHaveBeenCalledWith("product-1", {
      name: "Pickleballs",
      priceCents: 15000,
      active: false,
      stockCount: 0,
    });
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Disabled — tap to enable")).toBeInTheDocument();
  });

  it("does not submit an unsaved price edit when only the toggle is pressed", async () => {
    mockedUpdateProduct.mockResolvedValue({ error: null });

    render(<ProductCatalog products={[product]} />);

    fireEvent.change(screen.getByLabelText("Price (₱)", { selector: "#price-product-1" }), { target: { value: "999.00" } });
    await toggleSwitchAsync(screen.getByRole("switch", { name: /pickleballs active/i }));

    expect(mockedUpdateProduct).toHaveBeenCalledWith(
      "product-1",
      expect.objectContaining({ priceCents: 15000 }), // last-saved price, not the unsaved 999
    );
  });

  it("reverts the switch and pill together if the save fails", async () => {
    mockedUpdateProduct.mockResolvedValue({ error: "Something went wrong." });

    render(<ProductCatalog products={[product]} />);

    await toggleSwitchAsync(screen.getByRole("switch", { name: /pickleballs active/i }));

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Active — tap to disable")).toBeInTheDocument();
  });
});
