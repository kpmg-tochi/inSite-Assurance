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

export const defaultColors = {
  primary: '#00338D',
  primaryDark: '#0C233C',
  background: '#F8FAFC',
  border: '#E2E8F0',
  accent: '#38BDF8',
  primaryText: '#0F172A',
  secondaryText: '#64748B',
};

export const colors = {
  ...defaultColors,
  surface: '#FFFFFF',
  componentBackground: '#FFFFFF',
  pageBackground: '#F8FAFC',
  cardBackground: '#FFFFFF',
  red: '#DC2626',
  green: '#059669',
  blue: '#0284C7',
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
