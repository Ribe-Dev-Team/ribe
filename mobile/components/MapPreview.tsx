import React from 'react';
import { Text, View, ViewStyle } from 'react-native';
import styles, { colors } from '../styles';

//this can mainly be disregarded as it will be updated with google API.

interface MapPreviewProps {
	routeShown: boolean;
	locations: string[];
}

const markerPositions: ViewStyle[] = [
	{ top: 119, left: '17%' },
	{ top: 82, left: '42%' },
	{ top: 55, left: '61%' },
	{ top: 38, right: '16%' },
];

export default function MapPreview({ routeShown, locations }: MapPreviewProps) {
    //TODO: update to use Google Maps API with real locations
    //TODO: update visibleLocations to no longer be a thing
    //TODO: update markers to be more informative
    //TODO: add interaction to map?
	const visibleLocations = locations.length ? locations : ['Pickup', 'Drop-off'];
	const positions = visibleLocations.map((_, index) => markerPositions[index % markerPositions.length]);

	return (
		<View style={styles.mapPreview} accessibilityLabel={routeShown ? 'Preview of the ride route' : 'Map showing ride locations'}>
			<View style={styles.mapRoadOne} />
			<View style={styles.mapRoadTwo} />
			<View style={styles.mapRoadThree} />
			{routeShown && positions.slice(0, -1).map((position, index) => (
				<View key={`route-${index}`} style={[styles.mapRoute, position, index % 2 ? styles.mapRouteAlternate : null]} />
			))}
			{visibleLocations.map((location, index) => {
				const isPickup = index === 0;
				const isDropoff = index === visibleLocations.length - 1;
				return (
					<View key={`${location}-${index}`} style={[styles.mapMarker, positions[index], isDropoff ? styles.mapDropoffMarker : null, !isPickup && !isDropoff ? styles.mapStopMarker : null]}>
						<Text style={styles.mapMarkerText}>{isPickup ? 'A' : isDropoff ? 'B' : index + 1}</Text>
					</View>
				);
			})}
			<View style={styles.mapCaption}><Text style={styles.mapCaptionText}>{routeShown ? 'Route preview' : 'Pickup and drop-off preview'}</Text></View>
		</View>
	);
}
