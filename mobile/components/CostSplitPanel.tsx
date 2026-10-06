import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import styles, { colors } from '../styles';
import { geocodeAddress, MONASH_CLAYTON_LOCATION } from '../services/googlePlaces';
import { fetchMedianFuelPrice, MedianFuelPrice } from '../services/fuelPrices';
import { fetchDrivingDistanceKm, fetchTripDistances, LatLng } from '../services/routeDistances';
import { calcCostSplit, CostSplit, DEFAULT_VEHICLE_ECONOMY, formatDollars } from '../utility/costSplitting';

interface CostSplitPanelProps {
  pickupAddress: string;
  destinationAddress: string;
  /** Where the driver starts. Until a match exists this is unknown, so detour cost is left at $0. */
  driverOriginAddress?: string;
  /** Driver + passengers. */
  tripParticipants?: number;
  /** Total parking for the trip in $, split evenly across participants. */
  parkingCost?: number;
  /** Driver's vehicle economy in L/100km. */
  vehicleEconomy?: number;
}

type PanelState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; split: CostSplit; fuel: MedianFuelPrice; tripDistanceKm: number; detourDistanceKm: number };

async function resolveLocation(address: string): Promise<LatLng | null> {
  if (/monash/i.test(address)) return MONASH_CLAYTON_LOCATION;
  return geocodeAddress(address);
}

export default function CostSplitPanel({
  pickupAddress,
  destinationAddress,
  driverOriginAddress,
  tripParticipants = 2,
  parkingCost = 0,
  vehicleEconomy = DEFAULT_VEHICLE_ECONOMY,
}: CostSplitPanelProps) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;

    const load = async () => {
      setState({ kind: 'loading' });
      const [fuel, pickup, destination, driverOrigin] = await Promise.all([
        fetchMedianFuelPrice(),
        resolveLocation(pickupAddress),
        resolveLocation(destinationAddress),
        driverOriginAddress ? resolveLocation(driverOriginAddress) : Promise.resolve(null),
      ]);
      if (!active) return;
      if (!pickup || !destination) {
        setState({ kind: 'unavailable' });
        return;
      }

      // No driver yet: estimate the trip as pickup -> destination with no detour.
      const distances = driverOrigin
        ? await fetchTripDistances(driverOrigin, destination, pickup)
        : await fetchDrivingDistanceKm(pickup, destination).then((km) => (km === null ? null : { tripDistanceKm: km, detourDistanceKm: 0 }));
      if (!active) return;
      if (!distances) {
        setState({ kind: 'unavailable' });
        return;
      }

      const split = calcCostSplit({
        medianFuelPrice: fuel.price,
        vehicleEconomy,
        tripParticipants,
        parkingCost,
        ...distances,
      });
      setState({ kind: 'ready', split, fuel, ...distances });
    };

    load().catch((err) => {
      console.warn('Cost split failed:', err);
      if (active) setState({ kind: 'unavailable' });
    });

    return () => {
      active = false;
    };
  }, [pickupAddress, destinationAddress, driverOriginAddress, tripParticipants, parkingCost, vehicleEconomy]);

  return (
    <View style={styles.costPanel}>
      <Text style={styles.costTitle}>Suggested cost split</Text>
      {state.kind === 'loading' && <ActivityIndicator color={colors.darkBlue} />}
      {state.kind === 'unavailable' && (
        <Text style={styles.costNote}>A cost estimate isn't available for this route yet.</Text>
      )}
      {state.kind === 'ready' && (
        <>
          <Row label={`Fuel for trip (${state.tripDistanceKm.toFixed(1)} km)`} value={formatDollars(state.split.fuelCost)} />
          {state.split.parkingCost > 0 && <Row label="Parking" value={formatDollars(state.split.parkingCost)} />}
          <Row label={`Base share (÷ ${tripParticipants})`} value={formatDollars(state.split.baseTripContribution)} />
          <Row label={`Your detour (${state.detourDistanceKm.toFixed(1)} km)`} value={formatDollars(state.split.detourCost)} />
          <Row label="Your suggested contribution" value={formatDollars(state.split.passengerContribution)} />
          <Text style={styles.costNote}>
            Based on {state.fuel.source === 'servo-saver' ? 'the median' : 'an estimated'} {state.fuel.fuelType} price of{' '}
            {state.fuel.price.toFixed(1)}c/L and {vehicleEconomy} L/100km.
            {driverOriginAddress ? '' : ' Detour cost is added once you are matched with a driver.'}
          </Text>
        </>
      )}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.costRow}>
      <Text style={styles.costLabel}>{label}</Text>
      <Text style={styles.costValue}>{value}</Text>
    </View>
  );
}
