import React, { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import styles, { colors } from '../styles';
import { Booking } from './schema/booking.schema';
import { addRideRequest, addRideOffer, datePattern, dateExclusions, timePattern } from './schema/firebaseBookingMethods';
import DatePickerModal from '../components/DatePickerModal';
import TimePickerModal from '../components/TimePickerModal';
import NumberStepper from '../components/NumberStepper';
import AddressAutocompleteInput from '../components/AddressAutocompleteInput';
import RouteMapPreview from '../components/RouteMapPreview';
import { geocodeAddress, ResolvedPlace } from '../services/googlePlaces';

interface BookingPageProps {
  onDone: () => void;
  initialDate?: Date;
}

type Step = 'trip' | 'details' | 'confirm';
type FieldName = 'address' | 'travelDate' | 'depTime' | 'arrTime' | 'detourTime' | 'numSeats';

const BOOKING_DRAFT_KEY = 'ribe:bookingDraftV1';

interface BookingDraft {
  isDriving: boolean;
  toUni: boolean;
  address: string;
  travelDate: string;
  detourTime: number;
  numSeats: number;
  depTime: string;
  arrTime: string;
}

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

function toMinutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

function formatTime12h(time: string): string {
  if (!timePattern.test(time.trim())) return time;
  const [hh, mm] = time.trim().split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}:${String(mm).padStart(2, '0')} ${period}`;
}

export default function BookingPage({ onDone, initialDate }: BookingPageProps) {
  const [step, setStep] = useState<Step>('trip');
  const [isDriving, setIsDriving] = useState<boolean>(false);
  const [toUni, setToUni] = useState<boolean>(true);
  const [address, setAddress] = useState<string>('');
  const [addrErr, setAddrErr] = useState<string>('');
  const [addressPlace, setAddressPlace] = useState<ResolvedPlace | null>(null);
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
  const [hydrated, setHydrated] = useState<boolean>(false);

  // Restore any in-progress draft so a user doesn't lose their inputs if they navigate away mid-form.
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(BOOKING_DRAFT_KEY);
        if (raw && isMounted) {
          const draft: Partial<BookingDraft> = JSON.parse(raw);
          if (typeof draft.isDriving === 'boolean') setIsDriving(draft.isDriving);
          if (typeof draft.toUni === 'boolean') setToUni(draft.toUni);
          if (typeof draft.address === 'string') setAddress(draft.address);
          if (typeof draft.detourTime === 'number') setDetourTime(draft.detourTime);
          if (typeof draft.numSeats === 'number') setNumSeats(draft.numSeats);
          if (typeof draft.depTime === 'string') setDepTime(draft.depTime);
          if (typeof draft.arrTime === 'string') setArrTime(draft.arrTime);
          if (typeof draft.travelDate === 'string') {
            const parsed = parseTravelDate(draft.travelDate);
            setTravelDate(parsed && isFutureDate(parsed) ? draft.travelDate : '');
          }
        }
      } catch (err) {
        console.warn('Failed to restore booking draft:', err);
      } finally {
        if (isMounted) setHydrated(true);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // Keep the draft up to date as the user fills in the form.
  useEffect(() => {
    if (!hydrated) return;
    const draft: BookingDraft = { isDriving, toUni, address, travelDate, detourTime, numSeats, depTime, arrTime };
    AsyncStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(draft)).catch((err) => {
      console.warn('Failed to save booking draft:', err);
    });
  }, [hydrated, isDriving, toUni, address, travelDate, detourTime, numSeats, depTime, arrTime]);

  // A restored draft only carries the address text, not its resolved coordinates - re-resolve it once
  // so the route preview on step 1 isn't blank after reopening the page mid-booking.
  useEffect(() => {
    if (!hydrated || !address.trim()) return;
    let cancelled = false;
    geocodeAddress(address).then((resolved) => {
      if (resolved && !cancelled) setAddressPlace(resolved);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const depMinutes = timePattern.test(depTime.trim()) ? toMinutes(depTime.trim()) : null;
  const arrMinutes = timePattern.test(arrTime.trim()) ? toMinutes(arrTime.trim()) : null;
  const timeOrderWarning =
    depMinutes !== null && arrMinutes !== null && arrMinutes <= depMinutes
      ? 'Arrival time must be later than departure time.'
      : '';
  const detourWarning =
    isDriving && detourTime > 0 && depMinutes !== null && arrMinutes !== null && arrMinutes - depMinutes < detourTime
      ? `Detour of ${detourTime} min exceeds your ${arrMinutes - depMinutes} min travel window.`
      : '';

  const validateTripStep = (): boolean => {
    let valid = true;

    // address validation
    if (!address.trim()) {
      setAddrErr('Address is required.');
      valid = false;
    } else setAddrErr('');

    return valid;
  };

  const validateDetailsStep = (): boolean => {
    let valid = true;

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

    // arrival-after-departure and detour-vs-window sanity checks (surfaced inline as the user types)
    if (timeOrderWarning || detourWarning) valid = false;

    // return valid if no issues found, otherwise return false
    return valid;
  };

  const goToDetails = () => {
    if (!validateTripStep()) return;
    setStep('details');
  };

  const goToConfirm = () => {
    if (!validateDetailsStep()) return;
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
      await AsyncStorage.removeItem(BOOKING_DRAFT_KEY).catch(() => {});
      onDone();
    } catch (error) {
      console.error('Failed to create ride request/offer:', error);
      alert('Error submitting booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepLabels: Record<Step, string> = {
    trip: 'Step 1 of 3 · Trip',
    details: 'Step 2 of 3 · Details',
    confirm: 'Step 3 of 3 · Confirm & submit',
  };

  const progressIndicator = (
    <View style={localStyles.progressBlock}>
      <View style={localStyles.progressRow}>
        <View style={[localStyles.progressSegment, localStyles.progressSegmentActive]} />
        <View style={[localStyles.progressSegment, step !== 'trip' && localStyles.progressSegmentActive]} />
        <View style={[localStyles.progressSegment, step === 'confirm' && localStyles.progressSegmentActive]} />
      </View>
      <Text style={localStyles.progressLabel}>{stepLabels[step]}</Text>
    </View>
  );

  if (step === 'confirm') {
    return (
      <View style={localStyles.pageContainer}>
        <View style={localStyles.fixedHeader}>
          <Pressable style={localStyles.backButton} onPress={() => setStep('details')}>
            <Ionicons name="chevron-back" size={24} color={colors.white} />
            <Text style={localStyles.backButtonLabel}>Back</Text>
          </Pressable>
          <Text style={localStyles.headerTitle}>Confirm your request</Text>
          {progressIndicator}
        </View>

        <ScrollView contentContainerStyle={localStyles.scrollContent} showsVerticalScrollIndicator={false}>
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
            <Text style={localStyles.summaryValue}>{formatTime12h(depTime)}</Text>
          </View>
          <View style={localStyles.summaryRow}>
            <Text style={localStyles.summaryLabel}>Latest arrival</Text>
            <Text style={localStyles.summaryValue}>{formatTime12h(arrTime)}</Text>
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

        <View style={localStyles.card}>
          <Text style={localStyles.cardLabel}>Route preview</Text>
          <RouteMapPreview address={addressPlace} toUni={toUni} />
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
          <Pressable
            onPress={submitBooking}
            style={[localStyles.actionButton, isSubmitting && localStyles.actionButtonDisabled]}
            disabled={isSubmitting}
          >
            <Text style={styles.primaryButtonText}>{isSubmitting ? 'Submitting...' : 'Submit request'}</Text>
          </Pressable>
        </View>
        </ScrollView>
      </View>
    );
  }

  if (step === 'trip') {
    return (
      <View style={localStyles.pageContainer}>
        <View style={localStyles.fixedHeader}>
          <Pressable style={localStyles.backButton} onPress={onDone}>
            <Ionicons name="chevron-back" size={24} color={colors.white} />
            <Text style={localStyles.backButtonLabel}>Back</Text>
          </Pressable>
          <Text style={localStyles.headerTitle}>Request a ride</Text>
          {progressIndicator}
        </View>

        <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={localStyles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
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

            <View style={[localStyles.card, { zIndex: 5 }]}>
              <Text style={localStyles.cardLabel}>Where</Text>
              <Text style={localStyles.fieldLabel}>{toUni ? 'Pickup address' : 'Destination address'}</Text>
              <AddressAutocompleteInput
                inputStyle={[localStyles.fieldInput, focusedField === 'address' && localStyles.fieldInputFocused]}
                onBlur={() => setFocusedField(null)}
                onChangeText={(value) => setAddress(toTitleCase(value))}
                onFocus={() => setFocusedField('address')}
                onResolvedLocation={setAddressPlace}
                placeholder="123 Main St, Suburb"
                value={address}
              />
              {addrErr !== '' && <Text style={styles.errorText}>{addrErr}</Text>}

              <Text style={[localStyles.fieldLabel, { marginTop: 16 }]}>Route preview</Text>
              <RouteMapPreview address={addressPlace} toUni={toUni} />
            </View>

            <Pressable onPress={goToDetails} style={localStyles.actionButton}>
              <Text style={styles.primaryButtonText}>Next</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </View>
    );
  }

  return (
    <View style={localStyles.pageContainer}>
      <View style={localStyles.fixedHeader}>
        <Pressable style={localStyles.backButton} onPress={() => setStep('trip')}>
          <Ionicons name="chevron-back" size={24} color={colors.white} />
          <Text style={localStyles.backButtonLabel}>Back</Text>
        </Pressable>
        <Text style={localStyles.headerTitle}>Trip details</Text>
        {progressIndicator}
      </View>

      <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={localStyles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
                {depTime ? formatTime12h(depTime) : 'Select time'}
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
                {arrTime ? formatTime12h(arrTime) : 'Select time'}
              </Text>
              <Ionicons color="rgba(255,255,255,0.6)" name="time-outline" size={18} />
            </Pressable>
            {arrTimeErr !== '' && <Text style={styles.errorText}>{arrTimeErr}</Text>}
            {arrTimeErr === '' && timeOrderWarning !== '' && <Text style={localStyles.warningText}>{timeOrderWarning}</Text>}
          </View>

          {isDriving && (
            <View style={localStyles.card}>
              <Text style={localStyles.cardLabel}>Driver details</Text>
              <Text style={localStyles.fieldLabel}>Max detour (mins)</Text>
              <NumberStepper max={120} min={0} onChange={setDetourTime} step={5} style={localStyles.fieldInput} value={detourTime} />
              {detourTimeErr !== '' && <Text style={styles.errorText}>{detourTimeErr}</Text>}
              {detourTimeErr === '' && detourWarning !== '' && <Text style={localStyles.warningText}>{detourWarning}</Text>}

              <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Seats available</Text>
              <NumberStepper max={12} min={1} onChange={setNumSeats} style={localStyles.fieldInput} value={numSeats} />
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
    </View>
  );
}

const localStyles = StyleSheet.create({
  pageContainer: {
    flex: 1,
    backgroundColor: colors.darkBlue,
  },
  fixedHeader: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 12,
    backgroundColor: colors.darkBlue,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 20,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  backButtonLabel: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 17,
    color: colors.white,
  },
  headerTitle: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 22,
    color: colors.white,
    marginTop: 14,
  },
  progressBlock: {
    marginTop: 14,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 6,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  progressSegmentActive: {
    backgroundColor: colors.white,
  },
  progressLabel: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
  },
  warningText: {
    color: colors.awaiting,
    fontSize: 13,
    marginBottom: 8,
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
});
