const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const {
    APPLE_API_KEY_PATH,
    APPLE_API_KEY,
    APPLE_API_ISSUER,
    APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_TEAM_ID,
  } = process.env;

  if (APPLE_API_KEY_PATH && APPLE_API_KEY && APPLE_API_ISSUER) {
    await notarize({
      tool: 'notarytool',
      appPath,
      appleApiKey: APPLE_API_KEY_PATH,
      appleApiKeyId: APPLE_API_KEY,
      appleApiIssuer: APPLE_API_ISSUER,
    });
    return;
  }

  if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD) {
    await notarize({
      appBundleId: 'com.michaelborck.winnow',
      appPath,
      appleId: APPLE_ID,
      appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
      teamId: APPLE_TEAM_ID,
    });
    return;
  }

  console.log(
    'winnow: skipping notarization (no Apple API key or app-specific password)',
  );
};