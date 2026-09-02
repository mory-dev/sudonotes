// jsdom cannot lay out text, so CodeMirror's text-size measurement (which
// reads client rects of hidden tile elements) would see zero-sized ranges and
// throw. Give it a fixed fake rect so the editor measures cleanly in tests.

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function fakeRect() {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 100,
    bottom: 20,
    width: 100,
    height: 20,
    toJSON() {
      return {};
    },
  };
}

Object.defineProperty(Element.prototype, "getBoundingClientRect", {
  configurable: true,
  value: fakeRect,
});

Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  configurable: true,
  value: fakeRect,
});

Object.defineProperty(Range.prototype, "getClientRects", {
  configurable: true,
  value() {
    const rect = fakeRect();
    return {
      length: 1,
      0: rect,
      item: () => rect,
      [Symbol.iterator]() {
        return [rect][Symbol.iterator]();
      },
    };
  },
});
