import React, { useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import styles, { colors } from '../styles';
import { Booking } from './schema/booking.schema';
import { addRideRequest, addRideOffer, datePattern, dateExclusions, timePattern } from './schema/firebaseBookingMethods';
import DatePickerModal from '../components/DatePickerModal';
import TimePickerModal from '../components/TimePickerModal';

interface BookingPageProps {
  onDone: () => void;
  initialDate?: Date;
}

type Step = 'form' | 'confirm';
type FieldName = 'address' | 'travelDate' | 'depTime' | 'arrTime' | 'detourTime' | 'numSeats';

function formatTravelDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${date.getFullYear()}`;
}

function parseTravelDate(value: string): Date | undefined {
  if (!datePattern.test(value.trim())) return undefined;
  const [day, month, year] = value.trim().split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toTitleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function isFutureDate(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date > today;
}

export default function BookingPage({ onDone, initialDate }: BookingPageProps) {
  const [step, setStep] = useState<Step>('form');
  const [isDriving, setIsDriving] = useState<boolean>(false);
  const [toUni, setToUni] = useState<boolean>(true);
  const [address, setAddress] = useState<string>('');
  const [addrErr, setAddrErr] = useState<string>('');
  const [travelDate, setTravelDate] = useState<string>(
    initialDate && isFutureDate(initialDate) ? formatTravelDate(initialDate) : '',
  ); // Format: DD-MM-YYYY
  const [travelDateErr, setTravelDateErr] = useState<string>('');
  const [detourTime, setDetourTime] = useState<number>(0);
  const [detourTimeErr, setDetourTimeErr] = useState<string>('');
  const [numSeats, setNumSeats] = useState<number>(1);
  const [numSeatsErr, setNumSeatsErr] = useState<string>('');
  const [depTime, setDepTime] = useState<string>(''); // Format: HH:mm
  const [depTimeErr, setDepTimeErr] = useState<string>('');
  const [arrTime, setArrTime] = useState<string>(''); // Format: HH:mm
  const [arrTimeErr, setArrTimeErr] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [focusedField, setFocusedField] = useState<FieldName | null>(null);
  const [activePicker, setActivePicker] = useState<'date' | 'dep' | 'arr' | null>(null);

  const validateBooking = (): boolean => {
    let valid = true;

    // address validation
    if (!address.trim()) {
      setAddrErr('Address is required.');
      valid = false;
    } else setAddrErr('');

    // travel date validation
    if (!datePattern.test(travelDate.trim()) || dateExclusions.test(travelDate.trim())) {
      setTravelDateErr('Enter valid date in DD-MM-YYYY format.');
      valid = false;
    } else {
      const [day, month, year] = travelDate.trim().split('-').map(Number);
      const parsedDate = new Date(year, month - 1, day);
      if (isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
        setTravelDateErr('Date must be a valid future date.');
        valid = false;
      } else setTravelDateErr('');
    }

    // detour time & seats validation
    if (!isDriving) {
      setDetourTimeErr('');
      setDetourTime(0);
      setNumSeatsErr('');
    } else {
      if (detourTime <= 0) {
        setDetourTimeErr("Maximum detour time required");
      } else setDetourTimeErr('');

      if (numSeats < 1) {
        setNumSeatsErr("Ride offers require at least one available seat");
      } else if (numSeats > 12) {
        setNumSeatsErr("Too many seats offered. Max 12.");
      } else setNumSeatsErr('');
    }

    // departure time validation
    if (!timePattern.test(depTime.trim())) {
      setDepTimeErr('Departure time must be HH:mm (24-hr).');
      valid = false;
    } else setDepTimeErr('');

    // arrival time validation
    if (!timePattern.test(arrTime.trim())) {
      setArrTimeErr('Arrival time must be HH:mm (24-hr).');
      valid = false;
    } else setArrTimeErr('');

    // return valid if no issues found, otherwise return false
    return valid;
  };

  const goToConfirm = () => {
    if (!validateBooking()) return;
    setStep('confirm');
  };

  const submitBooking = async (): Promise<void> => {
    if (isSubmitting) return;

    setIsSubmitting(true);

    try {
      // Build common booking data
      const commonData: Booking = {
        isDriving,
        toUni,
        address: address.trim(),
        travelDate: travelDate.trim(),
        depTime: depTime.trim(),
        arrTime: arrTime.trim(),
      };
      // add detour time for drivers
      const bookingData: Booking = (isDriving)
        ? {
          ...commonData,
          detourTime: detourTime,
          capacity: numSeats,
        } : commonData;

      // Pass object to firebaseBookingMethods which converts it to Firestore format
      if (isDriving) {
        const newOfferId = await addRideOffer(bookingData);
        console.log('Ride offer created with ID:', newOfferId);
        alert('Ride offer successfully created!');
      } else {
        const newRequestId = await addRideRequest(bookingData);
        console.log('Ride request created with ID:', newRequestId);
        alert('Ride request successfully created!');
      }
      onDone();
    } catch (error) {
      console.error('Failed to create ride request/offer:', error);
      alert('Error submitting booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === 'confirm') {
    return (
      <ScrollView contentContainerStyle={localStyles.screen} showsVerticalScrollIndicator={false}>
        <Pressable style={localStyles.headerRow} onPress={() => setStep('form')}>
          <Ionicons name="chevron-back" size={22} color={colors.white} />
          <Text style={localStyles.headerTitle}>Confirm your request</Text>
        </Pressable>

        <View style={localStyles.card}>
          <View style={localStyles.summaryRow}>
            <Text style={localStyles.summaryLabel}>{toUni ? 'Pickup' : 'Destination'}</Text>
            <Text style={localStyles.summaryValue} numberOfLines={1}>{address}</Text>
          </View>
          <View style={localStyles.summaryRow}>
            <Text style={localStyles.summaryLabel}>Travel date</Text>
            <Text style={localStyles.summaryValue}>{travelDate}</Text>
          </View>
          <View style={localStyles.summaryRow}>
            <Text style={localStyles.summaryLabel}>Earliest departure</Text>
            <Text style={localStyles.summaryValue}>{depTime}</Text>
          </View>
          <View style={localStyles.summaryRow}>
            <Text style={localStyles.summaryLabel}>Latest arrival</Text>
            <Text style={localStyles.summaryValue}>{arrTime}</Text>
          </View>
          <View style={localStyles.summaryRow}>
            <Text style={localStyles.summaryLabel}>Role</Text>
            <Text style={localStyles.summaryValue}>{isDriving ? 'Offering a ride' : 'Requesting a ride'}</Text>
          </View>
          {isDriving && (
            <>
              <View style={localStyles.summaryRow}>
                <Text style={localStyles.summaryLabel}>Max detour</Text>
                <Text style={localStyles.summaryValue}>{detourTime} min</Text>
              </View>
              <View style={[localStyles.summaryRow, { borderBottomWidth: 0 }]}>
                <Text style={localStyles.summaryLabel}>Seats offered</Text>
                <Text style={localStyles.summaryValue}>{numSeats}</Text>
              </View>
            </>
          )}
        </View>

        <View style={localStyles.infoCard}>
          <View style={localStyles.infoHeaderRow}>
            <Ionicons name="information-circle-outline" size={16} color={colors.white} />
            <Text style={localStyles.infoTitle}>What happens next</Text>
          </View>
          <Text style={localStyles.infoText}>
            {isDriving
              ? "We'll match your offer with nearby ride requests. You'll be notified when a rider accepts."
              : "We'll look for a driver heading your way. If a match is found, you'll have 12 hours to accept before nothing is booked."}
          </Text>
        </View>

        <View style={localStyles.confirmActions}>
          <Pressable onPress={() => setStep('form')} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Back</Text>
          </Pressable>
          <Pressable
            onPress={submitBooking}
            style={[localStyles.actionButton, { flex: 1 }, isSubmitting && localStyles.actionButtonDisabled]}
            disabled={isSubmitting}
          >
            <Text style={styles.primaryButtonText}>{isSubmitting ? 'Submitting...' : 'Submit request'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={localStyles.screen}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable style={localStyles.headerRow} onPress={onDone}>
            <Ionicons name="chevron-back" size={22} color={colors.white} />
            <Text style={localStyles.headerTitle}>Request a ride</Text>
          </Pressable>

          <View style={localStyles.card}>
            <Text style={localStyles.cardLabel}>I am...</Text>
            <View style={localStyles.segmentRow}>
              <Pressable
                onPress={() => setIsDriving(false)}
                style={[localStyles.segmentOption, !isDriving && localStyles.segmentOptionActive]}
              >
                <Text style={[localStyles.segmentText, !isDriving && localStyles.segmentTextActive]}>Requesting a ride</Text>
              </Pressable>
              <Pressable
                onPress={() => setIsDriving(true)}
                style={[localStyles.segmentOption, isDriving && localStyles.segmentOptionActive]}
              >
                <Text style={[localStyles.segmentText, isDriving && localStyles.segmentTextActive]}>Offering a ride</Text>
              </Pressable>
            </View>

            <Text style={[localStyles.cardLabel, { marginTop: 16 }]}>Direction</Text>
            <View style={localStyles.segmentRow}>
              <Pressable
                onPress={() => setToUni(true)}
                style={[localStyles.segmentOption, toUni && localStyles.segmentOptionActive]}
              >
                <Text style={[localStyles.segmentText, toUni && localStyles.segmentTextActive]}>To uni</Text>
              </Pressable>
              <Pressable
                onPress={() => setToUni(false)}
                style={[localStyles.segmentOption, !toUni && localStyles.segmentOptionActive]}
              >
                <Text style={[localStyles.segmentText, !toUni && localStyles.segmentTextActive]}>From uni</Text>
              </Pressable>
            </View>
          </View>

          <View style={localStyles.card}>
            <Text style={localStyles.cardLabel}>Where</Text>
            <Text style={localStyles.fieldLabel}>{toUni ? 'Pickup address' : 'Destination address'}</Text>
            <TextInput
              autoCapitalize="words"
              onBlur={() => setFocusedField(null)}
              onChangeText={(value) => setAddress(toTitleCase(value))}
              onFocus={() => setFocusedField('address')}
              style={[localStyles.fieldInput, focusedField === 'address' && localStyles.fieldInputFocused]}
              value={address}
              placeholder="123 Main St, Suburb"
              placeholderTextColor="rgba(255,255,255,0.4)"
            />
            {addrErr !== '' && <Text style={styles.errorText}>{addrErr}</Text>}
          </View>

          <View style={localStyles.card}>
            <Text style={localStyles.cardLabel}>When</Text>
            <Text style={localStyles.fieldLabel}>Travel date</Text>
            <Pressable
              onPress={() => {
                setFocusedField('travelDate');
                setActivePicker('date');
              }}
              style={[localStyles.fieldInput, localStyles.pickerField, focusedField === 'travelDate' && localStyles.fieldInputFocused]}
            >
              <Text style={travelDate ? localStyles.pickerValueText : localStyles.pickerPlaceholderText}>
                {travelDate || 'DD-MM-YYYY'}
              </Text>
              <Ionicons color="rgba(255,255,255,0.6)" name="calendar-outline" size={18} />
            </Pressable>
            {travelDateErr !== '' && <Text style={styles.errorText}>{travelDateErr}</Text>}

            <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Earliest departure</Text>
            <Pressable
              onPress={() => {
                setFocusedField('depTime');
                setActivePicker('dep');
              }}
              style={[localStyles.fieldInput, localStyles.pickerField, focusedField === 'depTime' && localStyles.fieldInputFocused]}
            >
              <Text style={depTime ? localStyles.pickerValueText : localStyles.pickerPlaceholderText}>
                {depTime || 'HH:MM (24hr)'}
              </Text>
              <Ionicons color="rgba(255,255,255,0.6)" name="time-outline" size={18} />
            </Pressable>
            {depTimeErr !== '' && <Text style={styles.errorText}>{depTimeErr}</Text>}

            <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Latest arrival</Text>
            <Pressable
              onPress={() => {
                setFocusedField('arrTime');
                setActivePicker('arr');
              }}
              style={[localStyles.fieldInput, localStyles.pickerField, focusedField === 'arrTime' && localStyles.fieldInputFocused]}
            >
              <Text style={arrTime ? localStyles.pickerValueText : localStyles.pickerPlaceholderText}>
                {arrTime || 'HH:MM (24hr)'}
              </Text>
              <Ionicons color="rgba(255,255,255,0.6)" name="time-outline" size={18} />
            </Pressable>
            {arrTimeErr !== '' && <Text style={styles.errorText}>{arrTimeErr}</Text>}
          </View>

          {isDriving && (
            <View style={localStyles.card}>
              <Text style={localStyles.cardLabel}>Driver details</Text>
              <Text style={localStyles.fieldLabel}>Max detour (mins)</Text>
              <TextInput
                keyboardType="number-pad"
                onBlur={() => setFocusedField(null)}
                onChangeText={(str) => setDetourTime(Number(str) || 0)}
                onFocus={() => setFocusedField('detourTime')}
                style={[localStyles.fieldInput, focusedField === 'detourTime' && localStyles.fieldInputFocused]}
                placeholder="10"
                placeholderTextColor="rgba(255,255,255,0.4)"
              />
              {detourTimeErr !== '' && <Text style={styles.errorText}>{detourTimeErr}</Text>}

              <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Seats available</Text>
              <TextInput
                keyboardType="number-pad"
                onBlur={() => setFocusedField(null)}
                onChangeText={(str) => setNumSeats(Number(str) || 0)}
                onFocus={() => setFocusedField('numSeats')}
                style={[localStyles.fieldInput, focusedField === 'numSeats' && localStyles.fieldInputFocused]}
                placeholder="1"
                placeholderTextColor="rgba(255,255,255,0.4)"
              />
              {numSeatsErr !== '' && <Text style={styles.errorText}>{numSeatsErr}</Text>}
            </View>
          )}

          <Pressable onPress={goToConfirm} style={localStyles.actionButton}>
            <Text style={styles.primaryButtonText}>Next</Text>
          </Pressable>
        </ScrollView>

        <DatePickerModal
          initialDate={parseTravelDate(travelDate)}
          onClose={() => {
            setActivePicker(null);
            setFocusedField(null);
          }}
          onSelect={(date) => {
            setTravelDate(formatTravelDate(date));
            setActivePicker(null);
            setFocusedField(null);
          }}
          visible={activePicker === 'date'}
        />

        <TimePickerModal
          initialTime={depTime}
          label="Earliest departure"
          onClose={() => {
            setActivePicker(null);
            setFocusedField(null);
          }}
          onSelect={(time) => {
            setDepTime(time);
            setActivePicker(null);
            setFocusedField(null);
          }}
          visible={activePicker === 'dep'}
        />

        <TimePickerModal
          initialTime={arrTime}
          label="Latest arrival"
          onClose={() => {
            setActivePicker(null);
            setFocusedField(null);
          }}
          onSelect={(time) => {
            setArrTime(time);
            setActivePicker(null);
            setFocusedField(null);
          }}
          visible={activePicker === 'arr'}
        />
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const localStyles = StyleSheet.create({
  screen: {
    padding: 20,
    paddingTop: 40,
    paddingBottom: 40,
    backgroundColor: colors.darkBlue,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  headerTitle: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 22,
    color: colors.white,
    marginLeft: 2,
  },
  card: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    backgroundColor: colors.mediumBlue,
  },
  cardLabel: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 16,
    color: colors.white,
    marginBottom: 10,
  },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 14,
    padding: 4,
  },
  segmentOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  segmentOptionActive: {
    backgroundColor: colors.darkBlue,
  },
  segmentText: {
    color: colors.white,
    opacity: 0.75,
    fontSize: 13,
    fontWeight: '600',
  },
  segmentTextActive: {
    opacity: 1,
  },
  fieldLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  fieldInput: {
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.white,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  fieldInputFocused: {
    borderColor: colors.white,
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerValueText: {
    fontSize: 15,
    color: colors.white,
  },
  pickerPlaceholderText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.4)',
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.mediumBlue,
    borderRadius: 12,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  actionButtonDisabled: {
    backgroundColor: 'rgba(19, 118, 190, 0.45)',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 9,
  },
  summaryLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
  },
  summaryValue: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  infoCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  infoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  infoTitle: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '700',
  },
  infoText: {
    color: colors.white,
    opacity: 0.85,
    fontSize: 12,
    lineHeight: 18,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelLink: {
    marginTop: 10,
    alignItems: 'center',
  },
  cancelLinkText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '600',
  },
});
