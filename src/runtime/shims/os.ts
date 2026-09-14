type NetworkInterfaceInfo = {
  address: string;
  family: "IPv4" | "IPv6";
};

const os = {
  networkInterfaces(): Record<string, NetworkInterfaceInfo[]> {
    // React Native does not expose host interfaces. Khie only listens on
    // WebRTC/circuit addresses, so there are no TCP wildcard addresses to expand.
    return {};
  },
};

export default os;
