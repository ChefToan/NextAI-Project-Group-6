import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` is a Next.js build-time marker with no runtime; stub it for tests.
      "server-only": fileURLToPath(new URL("./test/stubs/empty.ts", import.meta.url)),
      "@": root,
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    environment: "node",
  },
});
