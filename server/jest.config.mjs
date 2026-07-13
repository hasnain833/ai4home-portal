// Jest runs against the native ESM sources (package.json "type": "module"),
// so no Babel transform is applied. Run with NODE_OPTIONS=--experimental-vm-modules
// (wired into the "test" npm script).
export default {
  testEnvironment: "node",
  transform: {},
  testMatch: ["**/tests/**/*.test.js"],
};
