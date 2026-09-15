const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withTrustBluetoothPermissions(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const permissions = manifestConfig.modResults.manifest["uses-permission"] ?? [];

    for (const permission of permissions) {
      const name = permission.$?.["android:name"];
      if (
        name === "android.permission.BLUETOOTH" ||
        name === "android.permission.BLUETOOTH_ADMIN" ||
        name === "android.permission.ACCESS_FINE_LOCATION"
      ) {
        permission.$["android:maxSdkVersion"] = "30";
      }
      if (name === "android.permission.BLUETOOTH_SCAN") {
        permission.$["android:usesPermissionFlags"] = "neverForLocation";
      }
    }

    return manifestConfig;
  });
};
