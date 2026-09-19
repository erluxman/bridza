// Minimal config for running the node-side suites in a worktree with no
// node_modules: same `environment: node` as vite.config.ts, but without the
// react/tailwind plugins (and without importing vitest/config, which is not
// resolvable here), so these suites can run under `npx vitest --config <this>`.
export default {
  test: {
    environment: "node",
    include: ["src/app/__tests__/{bridza-store,bridza-run,bridza-flow-branch,bridza-model,plan,kanban-order}.test.js"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
};
