import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { ToastConfig, ToastConfigParams } from 'react-native-toast-message';
import {
  borderRadius,
  colors,
  componentShadow,
  spacing,
  textStyles,
} from '../styles/commonStyles';

export interface ToastCustomProps {
  title?: string;
  message?: string;
}

export const toastConfig: ToastConfig = {
  // Error
  error: ({ props, text1, text2 }: ToastConfigParams<ToastCustomProps>) => {
    const title = props?.title || (text2 ? text1 : undefined);
    const message = props?.message || (text2 ? text2 : text1) || '';

    return (
      <View
        style={[
          styles.container,
          {
            paddingVertical: title ? spacing.medium : spacing.medium,
            backgroundColor: colors.componentBackground,
          },
        ]}
      >
        {title ? (
          <View>
            <View style={styles.row}>
              <View style={[styles.iconCircle, { backgroundColor: colors.red }]}>
                <Feather name="x" size={13} color={colors.white} />
              </View>
              <Text
                style={[
                  styles.header,
                  { color: colors.primaryText, marginBottom: 3 },
                ]}
              >
                {title}
              </Text>
            </View>

            {message ? (
              <Text style={[styles.details, { color: colors.secondaryText }]}>
                {message}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.row}>
            <View style={[styles.iconCircle, { backgroundColor: colors.red }]}>
              <Feather name="x" size={13} color={colors.white} />
            </View>

            <Text
              style={[
                styles.detailsInline,
                { color: colors.primaryText, paddingLeft: 4 },
              ]}
            >
              {message}
            </Text>
          </View>
        )}
      </View>
    );
  },

  // Success
  success: ({ props, text1, text2 }: ToastConfigParams<ToastCustomProps>) => {
    const title = props?.title || (text2 ? text1 : undefined);
    const message = props?.message || (text2 ? text2 : text1) || '';

    return (
      <View
        style={[
          styles.container,
          {
            paddingVertical: spacing.medium,
            backgroundColor: colors.componentBackground,
          },
        ]}
      >
        <View style={styles.row}>
          <View style={[styles.iconCircle, { backgroundColor: colors.green }]}>
            <Feather name="check" size={14} color={colors.white} />
          </View>

          {title ? (
            <View style={styles.textWrap}>
              <Text
                style={[
                  styles.header,
                  { color: colors.primaryText, marginBottom: 2 },
                ]}
              >
                {title}
              </Text>
              {message ? (
                <Text
                  style={[styles.detailsInline, { color: colors.secondaryText }]}
                >
                  {message}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text
              style={[
                styles.header,
                { color: colors.primaryText, flex: 1, paddingLeft: 4 },
              ]}
            >
              {message}
            </Text>
          )}
        </View>
      </View>
    );
  },

  // Info
  info: ({ props, text1, text2 }: ToastConfigParams<ToastCustomProps>) => {
    const title = props?.title || (text2 ? text1 : undefined);
    const message = props?.message || (text2 ? text2 : text1) || '';

    return (
      <View
        style={[
          styles.container,
          {
            paddingVertical: spacing.medium,
            backgroundColor: colors.componentBackground,
          },
        ]}
      >
        <View style={styles.row}>
          <View
            style={[
              styles.iconCircle,
              {
                backgroundColor: colors.primary,
              },
            ]}
          >
            <Feather name="info" size={13} color={colors.white} />
          </View>

          {title ? (
            <View style={styles.textWrap}>
              <Text
                style={[
                  styles.header,
                  { color: colors.primaryText, marginBottom: 2 },
                ]}
              >
                {title}
              </Text>
              {message ? (
                <Text
                  style={[styles.detailsInline, { color: colors.secondaryText }]}
                >
                  {message}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text
              style={[
                styles.detailsInline,
                { paddingLeft: 4, color: colors.primaryText, flex: 1 },
              ]}
            >
              {message}
            </Text>
          )}
        </View>
      </View>
    );
  },

  // Warning
  warning: ({ props, text1, text2 }: ToastConfigParams<ToastCustomProps>) => {
    const title = props?.title || (text2 ? text1 : undefined);
    const message = props?.message || (text2 ? text2 : text1) || '';

    return (
      <View
        style={[
          styles.container,
          {
            paddingVertical: spacing.medium,
            backgroundColor: colors.componentBackground,
          },
        ]}
      >
        <View style={styles.row}>
          <View style={[styles.iconCircle, { backgroundColor: colors.amber }]}>
            <Feather name="alert-triangle" size={13} color={colors.white} />
          </View>

          {title ? (
            <View style={styles.textWrap}>
              <Text
                style={[
                  styles.header,
                  { color: colors.primaryText, marginBottom: 2 },
                ]}
              >
                {title}
              </Text>
              {message ? (
                <Text
                  style={[styles.detailsInline, { color: colors.secondaryText }]}
                >
                  {message}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text
              style={[
                styles.header,
                { color: colors.primaryText, flex: 1, paddingLeft: 4 },
              ]}
            >
              {message}
            </Text>
          )}
        </View>
      </View>
    );
  },
};

const styles = StyleSheet.create({
  container: {
    width: '90%',
    maxWidth: 420,
    marginTop: spacing.large,
    paddingHorizontal: spacing.medium,
    borderRadius: borderRadius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    ...componentShadow,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.small,
  },
  textWrap: {
    flex: 1,
    paddingLeft: 4,
  },
  header: {
    ...textStyles.h5,
    flexShrink: 1,
  },
  details: {
    ...textStyles.sm,
    paddingLeft: spacing.large + spacing.small,
    flexShrink: 1,
    marginTop: 1,
  },
  detailsInline: {
    ...textStyles.body,
    flexShrink: 1,
  },
  iconCircle: {
    height: 22,
    width: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

