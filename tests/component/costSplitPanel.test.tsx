// Component tests for mobile/components/CostSplitPanel.tsx: it only shows the
// split the backend stored - a rider's own share or a driver's passengers'
// total - and always says parking isn't included.

import * as React from 'react';
import { render, screen } from '@testing-library/react-native';
import CostSplitPanel from '../../mobile/components/CostSplitPanel';
import { RideCostSplit } from '../../mobile/utility/costDisplay';

const shared = {
  medianFuelPrice: 200, fuelType: 'U91', fuelSource: 'fallback' as const, vehicleEconomy: 10,
  tripDistanceKm: 30, tripParticipants: 3, fuelCost: 6, baseTripContribution: 2,
};

it("shows a rider's breakdown, and that it excludes parking", async () => {
  const split: RideCostSplit = { viewer: 'rider', ...shared, detourDistanceKm: 5, detourCost: 1, passengerContribution: 3 };
  await render(<CostSplitPanel costSplit={split} />);

  expect(screen.getByText('Fuel for trip (30.0 km)')).toBeTruthy();
  expect(screen.getByText('Base share (÷ 3)')).toBeTruthy();
  expect(screen.getByText('Your detour (5.0 km)')).toBeTruthy();
  expect(screen.getByText('$1.00')).toBeTruthy();
  expect(screen.getByText('$3.00')).toBeTruthy();
  expect(screen.getByText(/Excludes parking costs\./)).toBeTruthy();
  expect(screen.getByText(/an estimated U91 price of 200\.0c\/L and 10 L\/100km/)).toBeTruthy();
});

it("shows a driver their passengers' total instead of a share of their own", async () => {
  await render(<CostSplitPanel costSplit={{ viewer: 'driver', ...shared, passengersTotal: 5.25 }} />);

  expect(screen.getByText("Passengers' suggested contributions")).toBeTruthy();
  expect(screen.getByText('$5.25')).toBeTruthy();
  expect(screen.queryByText(/Your detour/)).toBeNull();
});

it('explains there is nothing yet before the ride is priced', async () => {
  await render(<CostSplitPanel />);

  expect(screen.getByText(/worked out once you're matched/)).toBeTruthy();
});
