// No test reaches the network: fetch throws, as it does offline, unless a test stubs its own. Assigned, not
// vi.stubGlobal: vi.unstubAllGlobals() after a test's own stub puts this one back, never the real fetch.
globalThis.fetch = async (input: string | URL | Request) => {
  throw new TypeError(`network refused in tests: ${input instanceof Request ? input.url : String(input)}`);
};
