import React, { useState } from "react";
import { Image } from "react-native";
import { SvgUri } from "react-native-svg";
import InSiteLogo from "../../../assets/InSite_Logo_White.svg";
import { useActiveBranding } from "../../context/ProfileContext";

/**
 * Header logo (Phase 6): the active tenant's logo when the tenant is known and has one, otherwise
 * the neutral InSite mark. Falls back to InSite if the tenant logo fails to load.
 */
export const BrandLogo: React.FC<{ size?: number }> = ({ size = 56 }) => {
  const { logoUrl, tenantName } = useActiveBranding();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!logoUrl || failedUrl === logoUrl) {
    return <InSiteLogo height={size} width={size} />;
  }
  if (/\.svg(\?|$)/i.test(logoUrl)) {
    return (
      <SvgUri
        uri={logoUrl}
        width={size}
        height={size}
        onError={() => setFailedUrl(logoUrl)}
        accessibilityLabel={tenantName ?? "Organisation logo"}
      />
    );
  }
  return (
    <Image
      source={{ uri: logoUrl }}
      style={{ width: size, height: size }}
      resizeMode="contain"
      onError={() => setFailedUrl(logoUrl)}
      accessibilityLabel={tenantName ?? "Organisation logo"}
    />
  );
};

export default BrandLogo;
