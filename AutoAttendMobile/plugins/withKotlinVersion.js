const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Sets android.kotlinVersion in gradle.properties.
 * The generated android/build.gradle uses:
 *   kotlinVersion = findProperty('android.kotlinVersion') ?: '1.9.24'
 * so this is the reliable way to override it.
 */
module.exports = function withKotlinVersion(config, { version = '2.1.21' } = {}) {
  return withGradleProperties(config, (config) => {
    const key = 'android.kotlinVersion';
    // Remove any existing entry for this key
    config.modResults = config.modResults.filter(
      (item) => !(item.type === 'property' && item.key === key),
    );
    config.modResults.push({ type: 'property', key, value: version });
    return config;
  });
};
