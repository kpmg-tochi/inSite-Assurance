export const defaultShadow = {
  shadowOffset: { width: 0, height: 3 },
  shadowRadius: 3,
  shadowColor: '#00000080',
  elevation: 3,
};

export const cardShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.04,
  shadowRadius: 6,
  elevation: 1,
};

export const componentShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.12,
  shadowRadius: 8,
  elevation: 4,
};

/**
 * UBEC palette, the same tokens as the web portal (`web/src/index.css`): deep green `#00715D`,
 * dark green `#122F2A`, UBEC green `#12915C`, and amber `#FFBF00` for accents on dark green only.
 */
export const defaultColors = {
  primary: '#00715D',
  primaryHover: '#005A4A',
  primaryDark: '#122F2A',
  medium: '#12915C',
  background: '#F6F8F7',
  border: '#E2E8F0',
  accent: '#FFBF00',
  primaryText: '#0F172A',
  secondaryText: '#64748B',
};

export const colors = {
  ...defaultColors,
  surface: '#FFFFFF',
  componentBackground: '#FFFFFF',
  pageBackground: '#F6F8F7',
  cardBackground: '#FFFFFF',
  red: '#DC2626',
  green: '#059669',
  blue: '#00715D',
  amber: '#D97706',
  white: '#FFFFFF',
};

export const spacing = {
  tiny: 4,
  small: 8,
  medium: 12,
  large: 16,
  xlarge: 24,
};

export const borderRadius = {
  small: 6,
  medium: 12,
  large: 16,
  full: 9999,
};

export const textStyles = {
  h5: {
    fontSize: 14,
    fontWeight: '700' as const,
    letterSpacing: -0.2,
  },
  sm: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
  body: {
    fontSize: 13,
    fontWeight: '500' as const,
    lineHeight: 18,
  },
};
