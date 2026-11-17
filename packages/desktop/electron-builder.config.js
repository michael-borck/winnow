module.exports = {
  appId: 'com.michaelborck.winnow',
  productName: 'Winnow',
  copyright: 'Copyright © 2026 Michael Borck',
  directories: {
    output: 'release',
    buildResources: 'assets',
  },
  asar: false,
  compression: 'maximum',
  files: ['dist/**/*', 'package.json'],
  extraResources: [
    { from: 'resources/server', to: 'server', filter: ['**/*', '!**/._*'] },
    { from: 'resources/web', to: 'web', filter: ['**/*', '!**/._*'] },
  ],
  afterPack: 'scripts/after-pack.js',
  afterSign: 'scripts/notarize.js',
  publish: {
    provider: 'github',
    owner: 'michael-borck',
    repo: 'winnow',
  },
  mac: {
    category: 'public.app-category.education',
    icon: 'assets/icon.png',
    hardenedRuntime: true,
    notarize: false,
    entitlements: 'assets/entitlements.mac.plist',
    entitlementsInherit: 'assets/entitlements.mac.plist',
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/icon.png',
    executableName: 'winnow',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    icon: 'assets/icon.png',
    category: 'Education',
    executableName: 'winnow',
    artifactName: 'Winnow-${version}-${arch}.${ext}',
  },
  deb: {
    packageName: 'winnow',
    depends: [
      'libgtk-3-0',
      'libnotify4',
      'libnss3',
      'libxss1',
      'libxtst6',
      'xdg-utils',
      'libatspi2.0-0',
      'libuuid1',
    ],
  },
};