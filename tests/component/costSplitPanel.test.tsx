// Component tests for mobile/components/CostSplitPanel.tsx: it only shows the
// split the backend stored - fuel, base share and detour, then the amount that
// matters in larger text. A rider sees base share, detour and their own
// contribution; a driver sees each passenger's contribution, which differ, and
// their earnings - all of them together. Parking isn't included.

import * as React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import CostSplitPanel from '../../mobile/components/CostSplitPanel';
import { RideCostSplit } from '../../mobile/utility/costDisplay';

const shared = {
  medianFuelPrice: 200, fuelType: 'U91', fuelSource: 'fallback' as const, vehicleEconomy: 10,
  tripDistanceKm: 30, tripParticipants: 3, fuelCost: 6, baseTripContribution: 2,
};
const fontSize = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style).fontSize;

it("shows a rider's breakdown, their own share in larger text", async () => {
  const split: RideCostSplit = { viewer: 'rider', ...shared, detourDistanceKm: 5, detourCost: 1, passengerContribution: 3 };
  await render(<CostSplitPanel costSplit={split} />);

  expect(screen.getByText('Fuel for Trip (30.0 km)')).toBeTruthy();
  expect(screen.getByText('$6.00')).toBeTruthy();
  expect(screen.getByText('Base Share (÷3)')).toBeTruthy();
  expect(screen.getByText('$2.00')).toBeTruthy();
  expect(screen.getByText('Detour Extra (5.0 km)')).toBeTruthy();
  expect(screen.getByText('$1.00')).toBeTruthy();
  expect(screen.getByText('Suggested Contribution')).toBeTruthy();
  expect(fontSize('$3.00')).toBeGreaterThan(fontSize('$1.00'));
});

it("shows a driver the fuel, each passenger's contribution, and their earnings in larger text", async () => {
  const split: RideCostSplit = {
    viewer: 'driver', ...shared, passengersTotal: 6.5,
    passengers: [
      { name: 'Joanne', detourDistanceKm: 5, detourCost: 1, contribution: 3 },
      { name: 'Tommy', detourDistanceKm: 7.5, detourCost: 1.5, contribution: 3.5 },
    ],
  };
  await render(<CostSplitPanel costSplit={split} />);

  expect(screen.getByText('Fuel for Trip (30.0 km)')).toBeTruthy();
  expect(screen.getByText("Joanne's Suggested Contribution")).toBeTruthy();
  expect(screen.getByText('$3.00')).toBeTruthy();
  expect(screen.getByText("Tommy's Suggested Contribution")).toBeTruthy();
  expect(screen.getByText('$3.50')).toBeTruthy();
  expect(screen.getByText('Your Earnings')).toBeTruthy();
  // The passengers' contributions together, larger than the rest.
  expect(fontSize('$6.50')).toBeGreaterThan(fontSize('$3.50'));
  // The rider's breakdown isn't the driver's to see.
  expect(screen.queryByText(/Base Share|Detour Extra/)).toBeNull();
  expect(screen.queryByText('Suggested Contribution')).toBeNull();
});

it("marks a passenger still deciding, and handles names ending in s", async () => {
  const split: RideCostSplit = {
    viewer: 'driver', ...shared, passengersTotal: 2,
    passengers: [{ name: 'James', awaiting: true, detourDistanceKm: 0, detourCost: 0, contribution: 2 }],
  };
  await render(<CostSplitPanel costSplit={split} />);

  expect(screen.getByText("James' (awaiting) Suggested Contribution")).toBeTruthy();
});

it('says only that it excludes parking costs', async () => {
  await render(<CostSplitPanel costSplit={{ viewer: 'driver', ...shared, passengersTotal: 4, passengers: [] }} />);

  expect(screen.getByText('Excludes parking costs.')).toBeTruthy();
  expect(screen.queryByText(/c\/L|L\/100km/)).toBeNull();
});

it('explains there is nothing yet before the ride is priced', async () => {
  await render(<CostSplitPanel />);

  expect(screen.getByText(/worked out once you're matched/)).toBeTruthy();
});
