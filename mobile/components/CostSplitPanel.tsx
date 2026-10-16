import React from 'react';
import { Text, View } from 'react-native';
import styles from '../styles';
import { formatDollars, PassengerCost, RideCostSplit } from '../utility/costDisplay';

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
      <Text style={styles.costTitle}>Suggested Cost Split</Text>
      {!costSplit ? (
        <Text style={styles.costNote}>
          A cost split is worked out once you're matched - check back after your ride is planned.
        </Text>
      ) : (
        <>
          <Row label={`Fuel for Trip (${costSplit.tripDistanceKm.toFixed(1)} km)`} value={formatDollars(costSplit.fuelCost)} />
          {costSplit.viewer === 'driver' ? (
            <>
              {/* What each passenger is suggested to give: the same base share
                  plus their own detour, so the amounts differ. */}
              {(costSplit.passengers ?? []).map((p, i) => (
                <Row key={i} label={`${possessive(p)} Suggested Contribution`} value={formatDollars(p.contribution)} />
              ))}
              <TotalRow label="Your Earnings" value={costSplit.passengersTotal ?? 0} />
            </>
          ) : (
            <>
              <Row label={`Base Share (÷${costSplit.tripParticipants})`} value={formatDollars(costSplit.baseTripContribution)} />
              <Row
                label={`Detour Extra (${(costSplit.detourDistanceKm ?? 0).toFixed(1)} km)`}
                value={formatDollars(costSplit.detourCost ?? 0)}
              />
              <TotalRow label="Suggested Contribution" value={costSplit.passengerContribution ?? 0} />
            </>
          )}
          <Text style={styles.costNote}>Excludes parking costs.</Text>
        </>
      )}
    </View>
  );
}

/** "Tommy's", "James'" - with the awaiting mark after it, not inside it. */
function possessive(p: PassengerCost) {
  const owner = p.name.endsWith('s') ? `${p.name}'` : `${p.name}'s`;
  return p.awaiting ? `${owner} (awaiting)` : owner;
}

/** The amount that matters, in larger text. */
function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.costTotalRow}>
      <Text style={styles.costTotalLabel}>{label}</Text>
      <Text style={styles.costTotalValue}>{formatDollars(value)}</Text>
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
