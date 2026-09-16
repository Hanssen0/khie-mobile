const { withGradleProperties } = require("expo/config-plugins");

const RELEASE_PROPERTIES = {
  "android.enableMinifyInReleaseBuilds": "true",
  "android.enableShrinkResourcesInReleaseBuilds": "true",
};

function setGradleProperty(properties, key, value) {
  const existing = properties.find(
    (property) => property.type === "property" && property.key === key,
  );

  if (existing) {
    existing.value = value;
    return;
  }

  properties.push({ type: "property", key, value });
}

module.exports = function withAndroidReleaseOptimizations(config) {
  return withGradleProperties(config, (gradlePropertiesConfig) => {
    for (const [key, value] of Object.entries(RELEASE_PROPERTIES)) {
      setGradleProperty(gradlePropertiesConfig.modResults, key, value);
    }

    return gradlePropertiesConfig;
  });
};
