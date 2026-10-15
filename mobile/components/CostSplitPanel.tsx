import React from 'react';
import { Text, View } from 'react-native';
import styles from '../styles';
import { formatDollars, RideCostSplit } from '../utility/costDisplay';

interface CostSplitPanelProps {
  /** Worked out by the matching runner and read from Firestore (rideData.ts).
   *  Absent until the runner has priced this ride's car. */
  costSplit?: RideCostSplit;
}

/** The suggested cost split for a ride. Displays stored figures only - every
 *  amount is calculated in the backend (backend/server/costSplitting). */
export default function CostSplitPanel({ costSplit }: CostSplitPanelProps) {
  return (
    <View style={styles.costPanel}>
      <Text style={styles.costTitle}>Suggested cost split</Text>
      {!costSplit ? (
        <Text style={styles.costNote}>
          A cost split is worked out once you're matched - check back after your ride is planned.
        </Text>
      ) : (
        <>
          <Row label={`Fuel for trip (${costSplit.tripDistanceKm.toFixed(1)} km)`} value={formatDollars(costSplit.fuelCost)} />
          <Row label={`Base share (÷ ${costSplit.tripParticipants})`} value={formatDollars(costSplit.baseTripContribution)} />
          {costSplit.viewer === 'rider' ? (
            <>
              <Row
                label={`Your detour (${(costSplit.detourDistanceKm ?? 0).toFixed(1)} km)`}
                value={formatDollars(costSplit.detourCost ?? 0)}
              />
              <Row label="Your suggested contribution" value={formatDollars(costSplit.passengerContribution ?? 0)} />
            </>
          ) : (
            <Row label="Passengers' suggested contributions" value={formatDollars(costSplit.passengersTotal ?? 0)} />
          )}
          <Text style={styles.costNote}>
            Excludes parking costs. Based on {costSplit.fuelSource === 'servo-saver' ? 'the median' : 'an estimated'}{' '}
            {costSplit.fuelType} price of {costSplit.medianFuelPrice.toFixed(1)}c/L and {costSplit.vehicleEconomy} L/100km.
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
