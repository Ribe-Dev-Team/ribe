import React, { createContext, useContext, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../styles';

export interface ThemedAlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface ThemedAlertOptions {
  cancelable?: boolean;
}

type ShowThemedAlert = (
  title: string,
  message?: string,
  buttons?: ThemedAlertButton[],
  options?: ThemedAlertOptions,
) => void;

export interface ThemedDialogAction {
  label: string;
  onPress: () => void;
  variant: 'primary' | 'secondary' | 'destructive';
}

interface ThemedDialogProps {
  visible: boolean;
  title: string;
  message: string;
  actions: ThemedDialogAction[];
  onRequestClose?: () => void;
}

const ThemedAlertContext = createContext<ShowThemedAlert | null>(null);

export function useThemedAlert(): ShowThemedAlert {
  const showAlert = useContext(ThemedAlertContext);
  if (!showAlert) {
    throw new Error('useThemedAlert must be used inside ThemedAlertProvider.');
  }
  return showAlert;
}

export function ThemedAlertProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<{
    title: string;
    message: string;
    actions: ThemedDialogAction[];
    cancelable: boolean;
  } | null>(null);

  const showAlert = useMemo<ShowThemedAlert>(() => (title, message = '', buttons, options) => {
    const alertButtons = buttons?.length ? buttons : [{ text: 'OK', style: 'default' as const }];
    setDialog({
      title,
      message,
      cancelable: options?.cancelable ?? false,
      actions: alertButtons.map((button) => ({
        label: button.text,
        variant: button.style === 'cancel'
          ? 'secondary'
          : button.style === 'destructive' ? 'destructive' : 'primary',
        onPress: () => {
          setDialog(null);
          button.onPress?.();
        },
      })),
    });
  }, []);

  const dismiss = () => {
    if (dialog?.cancelable) setDialog(null);
  };

  return (
    <ThemedAlertContext.Provider value={showAlert}>
      {children}
      <ThemedDialog
        actions={dialog?.actions ?? []}
        message={dialog?.message ?? ''}
        onRequestClose={dismiss}
        title={dialog?.title ?? ''}
        visible={dialog !== null}
      />
    </ThemedAlertContext.Provider>
  );
}

export default function ThemedDialog({
  visible,
  title,
  message,
  actions,
  onRequestClose,
}: ThemedDialogProps) {
  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={() => onRequestClose?.()}
    >
      <Pressable
        accessibilityLabel="Close dialog backdrop"
        onPress={onRequestClose}
        style={localStyles.backdrop}
      >
        <Pressable onPress={(event) => event.stopPropagation()} style={localStyles.card}>
          <Text accessibilityRole="header" style={localStyles.title}>{title}</Text>
          <Text style={localStyles.message}>{message}</Text>
          <View style={localStyles.actions}>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                onPress={action.onPress}
                style={[
                  localStyles.button,
                  action.variant === 'primary' && localStyles.primaryButton,
                  action.variant === 'destructive' && localStyles.destructiveButton,
                  action.variant === 'secondary' && localStyles.secondaryButton,
                ]}
              >
                <Text
                  style={[
                    localStyles.buttonText,
                    action.variant === 'secondary' && localStyles.secondaryButtonText,
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const localStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: colors.blackA50,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    padding: 22,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.whiteA20,
    backgroundColor: colors.darkBlue,
  },
  title: {
    color: colors.white,
    fontFamily: 'Marcellus_400Regular',
    fontSize: 22,
    textAlign: 'center',
  },
  message: {
    color: colors.whiteA85,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },
  button: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  primaryButton: {
    backgroundColor: colors.confirmed,
  },
  destructiveButton: {
    backgroundColor: colors.cancelled,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.whiteA40,
    backgroundColor: colors.whiteA08,
  },
  buttonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondaryButtonText: {
    color: colors.whiteA85,
  },
});
