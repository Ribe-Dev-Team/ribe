import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../styles';
import { GOOGLE_MAPS_API_KEY, isPlacesConfigured, MONASH_CLAYTON_LOCATION, ResolvedPlace } from '../services/googlePlaces';

interface RouteMapPreviewProps {
  address: (ResolvedPlace & { label?: string }) | null;
  toUni: boolean; // true = address is the departure point, Monash is the arrival point (and vice versa)
}

const DEPARTURE_COLOR = colors.confirmed; // green
const ARRIVAL_COLOR = colors.pending; // coral

function toStaticMapColor(hex: string): string {
  return `0x${hex.replace('#', '')}`;
}

export default function RouteMapPreview({ address, toUni }: RouteMapPreviewProps) {
  if (!isPlacesConfigured()) {
    return (
      <View style={localStyles.placeholder}>
        <Text style={localStyles.placeholderText}>Route preview unavailable - no Google Maps API key configured.</Text>
      </View>
    );
  }

  if (!address) {
    return (
      <View style={localStyles.placeholder}>
        <Text style={localStyles.placeholderText}>Enter an address above to preview the route.</Text>
      </View>
    );
  }

  const addressPoint = { label: address.label ?? address.description, lat: address.lat, lng: address.lng };
  const departure = toUni ? addressPoint : MONASH_CLAYTON_LOCATION;
  const arrival = toUni ? MONASH_CLAYTON_LOCATION : addressPoint;

  const params = new URLSearchParams({ size: '600x260', scale: '2', maptype: 'roadmap', key: GOOGLE_MAPS_API_KEY });
  const departureMarker = `color:${toStaticMapColor(DEPARTURE_COLOR)}|label:A|${departure.lat},${departure.lng}`;
  const arrivalMarker = `color:${toStaticMapColor(ARRIVAL_COLOR)}|label:B|${arrival.lat},${arrival.lng}`;
  const uri =
    `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}` +
    `&markers=${encodeURIComponent(departureMarker)}&markers=${encodeURIComponent(arrivalMarker)}`;

  return (
    <View>
      <Image source={{ uri }} style={localStyles.mapImage} />
      <View style={localStyles.legendRow}>
        <View style={localStyles.legendItem}>
          <View style={[localStyles.legendDot, { backgroundColor: DEPARTURE_COLOR }]} />
          <Text numberOfLines={1} style={localStyles.legendText}>Departure · {departure.label}</Text>
        </View>
        <View style={localStyles.legendItem}>
          <View style={[localStyles.legendDot, { backgroundColor: ARRIVAL_COLOR }]} />
          <Text numberOfLines={1} style={localStyles.legendText}>Arrival · {arrival.label}</Text>
        </View>
      </View>
    </View>
  );
}

const localStyles = StyleSheet.create({
  mapImage: {
    width: '100%',
    height: 150,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  legendRow: {
    marginTop: 10,
    gap: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    flex: 1,
    color: colors.white,
    opacity: 0.85,
    fontSize: 12,
  },
  placeholder: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderStyle: 'dashed',
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100,
  },
  placeholderText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    textAlign: 'center',
  },
});
