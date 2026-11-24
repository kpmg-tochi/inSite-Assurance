import React, { useState } from "react";
import { Image } from "react-native";
import { SvgUri } from "react-native-svg";
import { useActiveBranding } from "../../context/ProfileContext";
import ubecLogo from "../../../assets/client/ubec-logo.png";
import ubecLogoFull from "../../../assets/client/ubec-logo-full.png";

/** The client's marks (UBEC rebrand), bundled so they show offline and before sign-in. */
export const DEFAULT_LOGO = ubecLogo;
/** The mark with white lettering, for dark green backgrounds. */
export const DEFAULT_FULL_LOGO = ubecLogoFull;

/**
 * Header logo: the tenant's own logo when it has an absolute URL, otherwise the bundled UBEC mark
 * (as the web portal's `BrandLogo`). A web-relative logo path ("/client/…") cannot load on a phone,
 * so it is treated as no logo. Falls back to the UBEC mark if the tenant logo fails to load.
 */
export const BrandLogo: React.FC<{ size?: number }> = ({ size = 56 }) => {
  const { logoUrl, tenantName } = useActiveBranding();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const label = tenantName ?? "Universal Basic Education Commission (UBEC)";
  const remote = logoUrl && /^https?:\/\//i.test(logoUrl) && failedUrl !== logoUrl ? logoUrl : null;

  if (!remote) {
    return <Image source={DEFAULT_LOGO} style={{ width: size, height: size }} resizeMode="contain" accessibilityLabel={label} />;
  }
  if (/\.svg(\?|$)/i.test(remote)) {
    return <SvgUri uri={remote} width={size} height={size} onError={() => setFailedUrl(remote)} accessibilityLabel={label} />;
  }
  return (
    <Image
      source={{ uri: remote }}
      style={{ width: size, height: size }}
      resizeMode="contain"
      onError={() => setFailedUrl(remote)}
      accessibilityLabel={label}
    />
  );
};

export default BrandLogo;
