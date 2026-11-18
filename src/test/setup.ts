import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

class ResizeObserverStub implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub

// jsdom does not implement scrolling; the router calls it on navigation.
// Node-environment tests (tools/mcp) have no window.
if (typeof window !== 'undefined') window.scrollTo = () => {}
