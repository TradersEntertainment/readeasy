import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // App Store Connect'te uygulamayı oluştururken aynı bundle ID'yi kullanın.
  appId: "com.tradersentertainment.readeasy",
  appName: "ReadEasy",
  webDir: "dist",
  ios: {
    contentInset: "never",
    backgroundColor: "#0b0b12",
  },
};

export default config;
