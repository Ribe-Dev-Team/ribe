import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, TextInput, TextStyle, View } from 'react-native';
import { colors } from '../styles';
import {
  createSessionToken,
  fetchPlaceDetails,
  fetchPlacePredictions,
  geocodeAddress,
  isPlacesConfigured,
  PlacePrediction,
  ResolvedPlace,
} from '../services/googlePlaces';

interface AddressAutocompleteInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onResolvedLocation: (place: ResolvedPlace | null) => void;
  inputStyle?: StyleProp<TextStyle>;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

const DEBOUNCE_MS = 300;

export default function AddressAutocompleteInput({
  value,
  onChangeText,
  onResolvedLocation,
  inputStyle,
  placeholder,
  onFocus,
  onBlur,
}: AddressAutocompleteInputProps) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inputHeight, setInputHeight] = useState(46);
  const sessionTokenRef = useRef(createSessionToken());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResolvedDescription = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChangeText = (text: string) => {
    onChangeText(text);
    setShowDropdown(true);

    if (lastResolvedDescription.current !== text) {
      lastResolvedDescription.current = null;
      onResolvedLocation(null);
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isPlacesConfigured() || !text.trim()) {
      setPredictions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const results = await fetchPlacePredictions(text, sessionTokenRef.current);
      setLoading(false);
      setPredictions(results);
    }, DEBOUNCE_MS);
  };

  const handleSelectPrediction = async (prediction: PlacePrediction) => {
    setShowDropdown(false);
    setPredictions([]);
    onChangeText(prediction.description);
    setLoading(true);
    const details = await fetchPlaceDetails(prediction.placeId, sessionTokenRef.current);
    setLoading(false);
    sessionTokenRef.current = createSessionToken(); // a Places billing session ends once details are fetched

    if (details) {
      lastResolvedDescription.current = prediction.description;
      onResolvedLocation(details);
    }
  };

  const handleBlur = () => {
    // Delay hiding: blur fires as soon as a dropdown item is touched, before its onPress
    // resolves, so hiding immediately would unmount the row mid-tap and swallow the selection.
    setTimeout(() => setShowDropdown(false), 150);
    onBlur?.();

    if (!value.trim() || lastResolvedDescription.current === value) return;
    // The user typed/edited an address without picking a suggestion - fall back to geocoding it directly.
    const typedValue = value;
    geocodeAddress(typedValue).then((resolved) => {
      if (resolved) {
        lastResolvedDescription.current = typedValue;
        onResolvedLocation(resolved);
      }
    });
  };

  return (
    <View style={localStyles.wrapper}>
      <TextInput
        autoCapitalize="words"
        onBlur={handleBlur}
        onChangeText={handleChangeText}
        onFocus={() => {
          onFocus?.();
          if (predictions.length) setShowDropdown(true);
        }}
        onLayout={(event) => setInputHeight(event.nativeEvent.layout.height)}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.4)"
        style={inputStyle}
        value={value}
      />

      {loading && <ActivityIndicator color={colors.white} size="small" style={localStyles.spinner} />}

      {showDropdown && predictions.length > 0 && (
        <View style={[localStyles.dropdown, { top: inputHeight + 6 }]}>
          {predictions.map((item, index) => (
            <Pressable
              key={item.placeId}
              onPress={() => handleSelectPrediction(item)}
              style={[localStyles.dropdownItem, index > 0 && localStyles.dropdownItemDivider]}
            >
              <Text numberOfLines={2} style={localStyles.dropdownItemText}>
                {item.description}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  wrapper: {
    zIndex: 20,
  },
  spinner: {
    position: 'absolute',
    right: 12,
    top: 12,
  },
  dropdown: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 30,
    elevation: 8,
    borderRadius: 12,
    paddingVertical: 4,
    backgroundColor: colors.darkBlue,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dropdownItemDivider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  dropdownItemText: {
    color: colors.white,
    fontSize: 14,
  },
});
