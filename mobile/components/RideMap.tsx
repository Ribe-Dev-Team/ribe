import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../styles';
import { GOOGLE_MAPS_API_KEY, isPlacesConfigured } from '../services/googlePlaces';
import { fetchRoutePolyline } from '../services/googleRoutes';
import { RideMapPoint } from '../services/rideData';

/*
A ride's points on a real Google map - the same Static Maps image the booking
page previews with (RouteMapPreview), plus any pickups along the way. The road
route between them is drawn too when the Routes API can supply it; when it
can't, the map shows the points alone.

The map has no legend of its own: the details page's Journey section lists
every stop with the same A / 1, 2... / B marker.
*/

interface RideMapProps {
  /** In route order: where the trip starts, any stops, where it ends. */
  points: RideMapPoint[];
  /** Still loading the ride; holds the map's space. */
  loading?: boolean;
}

const START_COLOR = colors.confirmed; // green, as on the booking page
const END_COLOR = colors.pending;     // coral
const STOP_COLOR = colors.awaiting;

// Static Maps refuses URLs past 16,384 characters; a long route's polyline is
// dropped rather than losing the whole map.
const MAX_URL_LENGTH = 16_000;

const hex = (color: string) => `0x${color.replace('#', '')}`;

function markerOf(point: RideMapPoint, stopNumber: number): string {
  const [color, label] = point.kind === 'start' ? [START_COLOR, 'A']
    : point.kind === 'end' ? [END_COLOR, 'B']
    : [STOP_COLOR, stopNumber <= 9 ? String(stopNumber) : ''];
  return [`color:${hex(color)}`, label && `label:${label}`, `${point.lat},${point.lng}`].filter(Boolean).join('|');
}

/** The Static Maps image for these points, with the route if there is one. */
export function staticMapUrl(points: RideMapPoint[], polyline: string | null, apiKey: string): string {
  const params = new URLSearchParams({ size: '600x300', scale: '2', maptype: 'roadmap', key: apiKey });
  let stop = 0;
  const markers = points
    .map((p) => markerOf(p, p.kind === 'stop' ? ++stop : 0))
    .map((m) => `&markers=${encodeURIComponent(m)}`)
    .join('');
  const base = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}${markers}`;
  if (!polyline) return base;
  const withPath = `${base}&path=${encodeURIComponent(`color:${hex(colors.darkBlue)}cc|weight:4|enc:${polyline}`)}`;
  return withPath.length <= MAX_URL_LENGTH ? withPath : base;
}

export default function RideMap({ points, loading = false }: RideMapProps) {
  const [polyline, setPolyline] = useState<string | null>(null);
  const routeKey = points.map((p) => `${p.lat},${p.lng}`).join('|');

  useEffect(() => {
    let active = true;
    setPolyline(null);
    if (isPlacesConfigured() && points.length >= 2) {
      fetchRoutePolyline(points, GOOGLE_MAPS_API_KEY).then((encoded) => {
        if (active) setPolyline(encoded);
      });
    }
    return () => { active = false; };
    // routeKey stands in for `points`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  if (loading) {
    return <View style={[localStyles.mapImage, localStyles.spaced]} accessibilityLabel="Loading map" />;
  }
  if (!isPlacesConfigured() || points.length === 0) {
    return (
      <View style={localStyles.placeholder}>
        <Text style={localStyles.placeholderText}>
          {isPlacesConfigured()
            ? "A map isn't available for this ride - its address couldn't be located."
            : 'Map unavailable - no Google Maps API key configured.'}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: staticMapUrl(points, polyline, GOOGLE_MAPS_API_KEY) }}
      style={[localStyles.mapImage, localStyles.spaced]}
      accessibilityLabel={polyline ? 'Map of the ride route' : 'Map of the ride locations'}
    />
  );
}

/** A marker's colour on the map, for anything showing the same markers. */
export function markerColor(kind: RideMapPoint['kind']): string {
  return kind === 'start' ? START_COLOR : kind === 'end' ? END_COLOR : STOP_COLOR;
}

const localStyles = StyleSheet.create({
  mapImage: {
    width: '100%',
    height: 190,
    borderRadius: 22,
    backgroundColor: colors.whiteA08,
  },
  spaced: {
    marginBottom: 16,
  },
  placeholder: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.whiteA20,
    borderStyle: 'dashed',
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    marginBottom: 16,
  },
  placeholderText: {
    color: colors.whiteA60,
    fontSize: 13,
    textAlign: 'center',
  },
});
