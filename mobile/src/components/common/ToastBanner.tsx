import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type ToastType = 'error' | 'warning' | 'info' | 'success';

interface ToastBannerProps {
  visible: boolean;
  type?: ToastType;
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

const COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  error: { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B' },
  warning: { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E' },
  info: { bg: '#E8F4F1', border: '#B5DDD3', text: '#005A4A' },
  success: { bg: '#ECFDF5', border: '#A7F3D0', text: '#065F46' },
};

export const ToastBanner: React.FC<ToastBannerProps> = ({
  visible,
  type = 'error',
  message,
  onRetry,
  onDismiss,
}) => {
  if (!visible || !message) return null;
  const palette = COLORS[type];

  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.message, { color: palette.text }]} numberOfLines={3}>
        {message}
      </Text>
      <View style={styles.actions}>
        {onRetry && (
          <TouchableOpacity onPress={onRetry} activeOpacity={0.8}>
            <Text style={[styles.actionText, { color: palette.text }]}>
              Retry
            </Text>
          </TouchableOpacity>
        )}
        {onDismiss && (
          <TouchableOpacity onPress={onDismiss} activeOpacity={0.8}>
            <Text style={[styles.dismissText, { color: palette.text }]}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 14,
    marginTop: 8,
  },
  message: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  dismissText: {
    fontSize: 13,
    fontWeight: '800',
    paddingHorizontal: 2,
  },
});

