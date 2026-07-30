import "@testing-library/jest-dom";

// jsdom has no PointerEvent constructor. Base UI's Switch (unlike its
// Select) constructs one itself inside its own onClick handler regardless
// of how the click was triggered, so any test that clicks a <Switch>
// throws "PointerEvent is not a constructor" without this.
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
    }
  }
  // @ts-expect-error -- minimal polyfill, not a full PointerEvent implementation
  window.PointerEvent = PointerEventPolyfill;
}
