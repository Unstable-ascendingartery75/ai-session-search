const { MakerZIP } = require("@electron-forge/maker-zip");

module.exports = {
  packagerConfig: {
    name: "AI Session Search",
    executableName: "ai-session-search",
    appBundleId: "com.lililib.aisessionsearch",
    appCategoryType: "public.app-category.developer-tools",
    extendInfo: {
      CFBundleDisplayName: "AI Session Search",
    },
    asar: true,
    icon: "assets/icon",
    ignore: [
      /^\/.git($|\/)/,
      /^\/.github($|\/)/,
      /^\/docs($|\/)/,
      /^\/src($|\/)/,
      /^\/public($|\/)/,
      /^\/out($|\/)/,
      /^\/coverage($|\/)/,
      /^\/node_modules($|\/)/,
      /^\/.*\.test\.[cm]?[jt]sx?$/,
      /^\/tsconfig\.json$/,
      /^\/vite\.config\.ts$/,
      /^\/vitest\.config\.ts$/,
    ],
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ["darwin", "win32"])],
};
