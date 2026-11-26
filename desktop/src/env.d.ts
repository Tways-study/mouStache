/// <reference types="electron-vite/node" />
/// <reference types="vite/client" />

/**
 * Compile-time switch (electron.vite.config.ts): true ONLY for the e2e / packaged-test builds. In every release build
 * it is the literal false, so all test seams (fake clipboard, recorded paste, stubbed shortcuts, __mou* hooks) are
 * dead code and are not in the bundle at all.
 */
declare const __MOU_TEST_BUILD__: boolean;
