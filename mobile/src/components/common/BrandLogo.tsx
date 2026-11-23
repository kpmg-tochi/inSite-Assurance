import React, { useState } from "react";
import { Image } from "react-native";
import { SvgUri } from "react-native-svg";
import { useActiveBranding } from "../../context/ProfileContext";

// Demo branch: the bundled UBEC crest is the fallback mark (no InSite/KPMG mark on screen).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const UBEC_CREST = require("../../../assets/client/ubec-crest.png");

/**
 * Header logo (Phase 6): the active tenant's logo when the tenant is known and has a loadable
 * (absolute http/https) logo URL, otherwise the bundled crest. A relative web path such as
 * `/client/ubec-logo.png` cannot be loaded by the phone, so it also gets the crest, as does a logo
 * that fails to load.
 */
export const BrandLogo: React.FC<{ size?: number }> = ({ size = 56 }) => {
  const { logoUrl, tenantName } = useActiveBranding();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const label = tenantName ?? "Organisation logo";

  if (!logoUrl || !/^https?:\/\//i.test(logoUrl) || failedUrl === logoUrl) {
    return (
      <Image
        source={UBEC_CREST}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#FFFFFF" }}
        resizeMode="contain"
        accessibilityLabel={label}
      />
    );
  }
  if (/\.svg(\?|$)/i.test(logoUrl)) {
    return (
      <SvgUri
        uri={logoUrl}
        width={size}
        height={size}
        onError={() => setFailedUrl(logoUrl)}
        accessibilityLabel={label}
      />
    );
  }
  return (
    <Image
      source={{ uri: logoUrl }}
      style={{ width: size, height: size }}
      resizeMode="contain"
      onError={() => setFailedUrl(logoUrl)}
      accessibilityLabel={label}
    />
  );
};

export default BrandLogo;
