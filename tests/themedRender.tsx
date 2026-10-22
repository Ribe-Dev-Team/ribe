import React from 'react';
import { render, RenderOptions } from '@testing-library/react-native';
import { ThemedAlertProvider } from '../mobile/components/ThemedDialog';

export function renderWithThemedAlerts(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { ...options, wrapper: ThemedAlertProvider });
}
