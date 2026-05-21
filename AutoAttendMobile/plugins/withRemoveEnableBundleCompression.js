const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Removes `enableBundleCompression` from android/app/build.gradle.
 * The property was removed in @react-native/gradle-plugin 0.77+, but older
 * Expo prebuild templates still emit it, causing a build failure.
 */
module.exports = function withRemoveEnableBundleCompression(config) {
  return withAppBuildGradle(config, (config) => {
    config.modResults.contents = config.modResults.contents.replace(
      /[ \t]*enableBundleCompression\s*=\s*(true|false)[ \t]*\r?\n/g,
      '',
    );
    return config;
  });
};
