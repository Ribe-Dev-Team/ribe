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
import { Booking, BOOKING_HORIZON_DAYS } from './schema/booking.schema';
import { addRideRequest, addRideOffer } from './schema/firebaseBookingMethods';
import { formatTime12h } from '../utility/times';
import { formatDateToStr, formatWeekdayDate, parseDateAsStr } from '../utility/dates';
import { validateTripStep as validateTripStepFields, validateDetailsStep as validateDetailsStepFields, getTimeOrderWarning, getDetourWarning, isBookableDate, latestBookingDate } from './validation/bookingValidation';
import DatePickerModal from '../components/DatePickerModal';
import TimePickerModal from '../components/TimePickerModal';
import { useThemedAlert } from '../components/ThemedDialog';
import NumberStepper from '../components/NumberStepper';
import AddressAutocompleteInput from '../components/AddressAutocompleteInput';
import RouteMapPreview from '../components/RouteMapPreview';
import { geocodeAddress, ResolvedPlace } from '../services/googlePlaces';
import { useAuth } from '../auth/useAuth';
import { MAX_CAR_SEATS } from './schema/user.validation';
import { formatPhone } from '../utility/phone';

interface BookingPageProps {
  onDone: () => void;
  initialDate?: Date;
}

type Step = 'trip' | 'details' | 'confirm';
type FieldName = 'address' | 'travelDate' | 'depTime' | 'arrTime' | 'detourTime' | 'numSeats';

const BOOKING_DRAFT_KEY = 'ribe:bookingDraftV1';

/** Whether a saved draft holds anything the user filled in, beyond a blank
 *  form. A date alone doesn't count: one is filled in for them when they start
 *  from a day on the calendar, and is quick to pick again. */
export function draftHasProgress(draft: Partial<Booking>): boolean {
  return Boolean(
    (typeof draft.address === 'string' && draft.address.trim())
    || draft.depTime
    || draft.arrTime
    || draft.isDriving === true
    || draft.toUni === false
    || (typeof draft.detourTime === 'number' && draft.detourTime !== 0)
    || (typeof draft.capacity === 'number' && draft.capacity !== 1),
  );
}

function toTitleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

export default function BookingPage({ onDone, initialDate }: BookingPageProps) {
  const { user, profileData } = useAuth();
  const showAlert = useThemedAlert();
  // Passenger seats in the user's registered car - null when they have no car
  // registered, and so can't offer a ride (addRideOffer checks this too).
  const carSeats = profileData?.isDriver && profileData.licensePlate
    && Number.isInteger(profileData.seatsAvailable) && (profileData.seatsAvailable ?? 0) >= 1
    ? profileData.seatsAvailable as number
    : null;
  const canDrive = carSeats !== null;
  const [step, setStep] = useState<Step>('trip');
  const [isDriving, setIsDriving] = useState<boolean>(false);
  const [showDriveNote, setShowDriveNote] = useState(false);
  const [toUni, setToUni] = useState<boolean>(true);
  const [address, setAddress] = useState<string>('');
  const [addrErr, setAddrErr] = useState<string>('');
  const [addressPlace, setAddressPlace] = useState<ResolvedPlace | null>(null);
  const [travelDate, setTravelDate] = useState<string>(
    initialDate && isBookableDate(initialDate) ? formatDateToStr(initialDate) : '',
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

  // A user who navigated away mid-form is asked whether to pick up their
  // draft or start again. Nothing is saved over it until they've answered.
  useEffect(() => {
    let isMounted = true;
    const restore = (draft: Partial<Booking>) => {
      if (typeof draft.isDriving === 'boolean') setIsDriving(draft.isDriving);
      if (typeof draft.toUni === 'boolean') setToUni(draft.toUni);
      if (typeof draft.address === 'string') setAddress(draft.address);
      if (typeof draft.detourTime === 'number') setDetourTime(draft.detourTime);
      if (typeof draft.capacity === 'number') setNumSeats(draft.capacity);
      if (typeof draft.depTime === 'string') setDepTime(draft.depTime);
      if (typeof draft.arrTime === 'string') setArrTime(draft.arrTime);
      // The draft's date if it can still be booked, else the calendar day they came from.
      const parsed = typeof draft.travelDate === 'string' ? parseDateAsStr(draft.travelDate) : null;
      if (parsed && isBookableDate(parsed)) setTravelDate(draft.travelDate as string);
    };
    const finish = () => { if (isMounted) setHydrated(true); };

    (async () => {
      let draft: Partial<Booking> | null = null;
      try {
        const raw = await AsyncStorage.getItem(BOOKING_DRAFT_KEY);
        draft = raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.warn('Failed to restore booking draft:', err);
      }
      if (!isMounted) return;
      if (!draft || !draftHasProgress(draft)) {
        finish();
        return;
      }
      const saved = draft;
      showAlert(
        'Continue where you left off?',
        'You have a ride you started but didn\'t submit.',
        [
          { text: 'Start Fresh', style: 'cancel', onPress: finish },
          { text: 'Continue', onPress: () => { if (isMounted) restore(saved); finish(); } },
        ],
        { cancelable: false },
      );
    })();
    return () => {
      isMounted = false;
    };
  }, [showAlert]);

  // Keep the draft up to date as the user fills in the form.
  useEffect(() => {
    if (!hydrated) return;
    const draft: Booking = { isDriving, toUni, address, travelDate, detourTime, capacity: numSeats, depTime, arrTime };
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

  const timeOrderWarning = getTimeOrderWarning(depTime, arrTime);
  const detourWarning = getDetourWarning(detourTime, depTime, arrTime);

  const validateTripStep = (): boolean => {
    const { addrErr } = validateTripStepFields(address);
    setAddrErr(addrErr);
    return addrErr === '';
  };

  // A draft saved while offering a ride can't stay one for someone with no car
  // registered, and the seats can't stay above what the car holds.
  useEffect(() => {
    if (isDriving && !canDrive) setIsDriving(false);
  }, [isDriving, canDrive]);
  useEffect(() => {
    if (carSeats !== null && numSeats > carSeats) setNumSeats(carSeats);
  }, [carSeats, numSeats]);

  const validateDetailsStep = (): boolean => {
    const result = validateDetailsStepFields({
      travelDate, isDriving, detourTime, numSeats, depTime, arrTime, carSeats: carSeats ?? undefined,
    });
    setTravelDateErr(result.travelDateErr);
    setDetourTimeErr(result.detourTimeErr);
    setNumSeatsErr(result.numSeatsErr);
    setDepTimeErr(result.depTimeErr);
    setArrTimeErr(result.arrTimeErr);
    return result.valid;
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
      // Last-chance resolve. The draft-restore effect is async and the blur
      // handler only geocodes an address the user typed, so addressPlace can
      // still be null here for an otherwise perfectly valid address. Matching
      // needs the point, so it's worth one more lookup - but a booking without
      // one is still worth accepting, hence the null-tolerant fallback.
      let place = addressPlace;
      if (!place && address.trim()) {
        place = await geocodeAddress(address.trim());
      }

      // Build common booking data
      const commonData: Booking = {
        userId: user?.uid,
        status: 'pending',
        isDriving,
        toUni,
        address: address.trim(),
        // Google says `lng`, the matching module says `lon`. Converted here, at
        // the boundary, so nothing downstream has to remember the difference.
        ...(place ? { coord: { lat: place.lat, lon: place.lng } } : {}),
        travelDate: travelDate.trim(),
        depTime: depTime.trim(),
        arrTime: arrTime.trim(),
      };
      // Detour and seats are driver-only; a rider's detour cap is derived at
      // match time rather than collected here.
      const bookingData: Booking = (isDriving)
        ? { ...commonData, detourTime, capacity: numSeats }
        : commonData;

      // Pass object to firebaseBookingMethods which converts it to Firestore format
      if (isDriving) {
        const newOfferId = await addRideOffer(bookingData);
        console.log('Ride offer created with ID:', newOfferId);
        await AsyncStorage.removeItem(BOOKING_DRAFT_KEY).catch((error) => {
          console.warn('Failed to clear submitted booking draft:', error);
        });
        showAlert('Ride offer created', 'Your drive is posted and ready for matching.', [
          { text: 'Done', onPress: onDone },
        ]);
      } else {
        const newRequestId = await addRideRequest(bookingData);
        console.log('Ride request created with ID:', newRequestId);
        await AsyncStorage.removeItem(BOOKING_DRAFT_KEY).catch((error) => {
          console.warn('Failed to clear submitted booking draft:', error);
        });
        showAlert('Ride request created', 'Your request is posted and ready for matching.', [
          { text: 'Done', onPress: onDone },
        ]);
      }
    } catch (error) {
      console.error('Failed to create ride request/offer:', error);
      const msg = error instanceof Error ? error.message : JSON.stringify(error);
      showAlert('Could not create ride', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepLabels: Record<Step, string> = {
    trip: 'Step 1 of 3 · Trip',
    details: 'Step 2 of 3 · Details',
    confirm: 'Step 3 of 3 · Confirm & Submit',
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
    const travelDay = parseDateAsStr(travelDate);
    return (
      <>
      <View style={localStyles.pageContainer}>
        <View style={localStyles.fixedHeader}>
          <Pressable style={localStyles.backButton} onPress={() => setStep('details')}>
            <Ionicons name="chevron-back" size={24} color={colors.white} />
            <Text style={localStyles.backButtonLabel}>Back</Text>
          </Pressable>
          <Text style={localStyles.headerTitle}>{isDriving ? 'Confirm Your Offer' : 'Confirm Your Request'}</Text>
          {progressIndicator}
        </View>

        <ScrollView contentContainerStyle={localStyles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Who's going: the car a driver is offering, or the details a rider's
              driver will see - in place of a "Role" row in the table below. */}
          <View style={localStyles.card}>
            <View>
              <Text style={localStyles.youTitle}>{isDriving ? "You're Offering a Ride" : "You're Requesting a Ride"}</Text>
              <Text style={localStyles.youDetail}>
                {[profileData?.name, profileData?.phoneNumber ? formatPhone(profileData.phoneNumber) : null].filter(Boolean).join('  ·  ')}
              </Text>
              {isDriving ? (
                <>
                  <View style={localStyles.youCarRow}>
                    <Text style={[localStyles.youDetail, { marginTop: 0 }]}>
                      {[profileData?.vehicleColor, profileData?.vehicleMake, profileData?.vehicleModel].filter(Boolean).join(' ') || 'Your car'}
                    </Text>
                    {profileData?.licensePlate ? <Text style={styles.plateBadge}>{profileData.licensePlate}</Text> : null}
                  </View>
                  <Text style={localStyles.youNote}>Riders matched to you will see your car and plate as well as your personal profile details.</Text>
                </>
              ) : (
                <Text style={localStyles.youNote}>
                  Your driver will see your first name, photo, degree, bio and pickup address once you're matched, and your number once the ride is confirmed.
                </Text>
              )}
            </View>
          </View>

          <View style={localStyles.card}>
            <View style={localStyles.summaryRow}>
              <Text style={localStyles.summaryLabel}>Travel Date</Text>
              <Text style={localStyles.summaryValue}>
                {travelDay ? formatWeekdayDate(travelDay) : travelDate}
              </Text>
            </View>
            <View style={localStyles.summaryRow}>
              <Text style={localStyles.summaryLabel}>Earliest Departure</Text>
              <Text style={localStyles.summaryValue}>{formatTime12h(depTime)}</Text>
            </View>
            <View style={[localStyles.summaryRow, !isDriving && { borderBottomWidth: 0 }]}>
              <Text style={localStyles.summaryLabel}>Latest Arrival</Text>
              <Text style={localStyles.summaryValue}>{formatTime12h(arrTime)}</Text>
            </View>
            {isDriving && (
              <>
                <View style={localStyles.summaryRow}>
                  <Text style={localStyles.summaryLabel}>Max Detour</Text>
                  <Text style={localStyles.summaryValue}>{detourTime} min</Text>
                </View>
                <View style={[localStyles.summaryRow, { borderBottomWidth: 0 }]}>
                  <Text style={localStyles.summaryLabel}>Seats Offered</Text>
                  <Text style={localStyles.summaryValue}>{numSeats}</Text>
                </View>
              </>
            )}
          </View>

          <View style={localStyles.card}>
            <Text style={localStyles.cardLabel}>Route Preview</Text>
            <RouteMapPreview address={addressPlace} toUni={toUni} />
          </View>

          <View style={localStyles.infoCard}>
            <View style={localStyles.infoHeaderRow}>
              <Ionicons name="information-circle-outline" size={16} color={colors.white} />
              <Text style={localStyles.infoTitle}>What Happens Next</Text>
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
              <Text style={styles.primaryButtonText}>
                {isSubmitting ? 'Submitting...' : isDriving ? 'Submit Offer' : 'Submit Request'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
      </>
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
          <Text style={localStyles.headerTitle}>{isDriving ? 'Offer a Ride' : 'Request a Ride'}</Text>
          {progressIndicator}
        </View>

        <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
            <ScrollView
              contentContainerStyle={localStyles.scrollContent}
              keyboardDismissMode="on-drag"
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
                    <Text style={[localStyles.segmentText, !isDriving && localStyles.segmentTextActive]}>Requesting a Ride</Text>
                  </Pressable>
                  <Pressable
                    accessibilityState={{ disabled: !canDrive }}
                    onPress={() => (canDrive ? setIsDriving(true) : setShowDriveNote(true))}
                    style={[localStyles.segmentOption, isDriving && localStyles.segmentOptionActive, !canDrive && localStyles.segmentOptionDisabled]}
                  >
                    <Text style={[localStyles.segmentText, isDriving && localStyles.segmentTextActive]}>Offering a Ride</Text>
                  </Pressable>
                </View>
                {!canDrive && showDriveNote && (
                  <Text style={[localStyles.warningText, { marginTop: 8 }]}>
                    To offer a ride, register as a driver with your car in your Profile first.
                  </Text>
                )}

                <Text style={[localStyles.cardLabel, { marginTop: 16 }]}>Direction</Text>
                <View style={localStyles.segmentRow}>
                  <Pressable
                    onPress={() => setToUni(true)}
                    style={[localStyles.segmentOption, toUni && localStyles.segmentOptionActive]}
                  >
                    <Text style={[localStyles.segmentText, toUni && localStyles.segmentTextActive]}>To Uni</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setToUni(false)}
                    style={[localStyles.segmentOption, !toUni && localStyles.segmentOptionActive]}
                  >
                    <Text style={[localStyles.segmentText, !toUni && localStyles.segmentTextActive]}>From Uni</Text>
                  </Pressable>
                </View>
              </View>

              <View style={[localStyles.card, { zIndex: 5 }]}>
                <Text style={localStyles.cardLabel}>Where</Text>
                <Text style={localStyles.fieldLabel}>{toUni ? 'Pickup Address' : 'Destination Address'}</Text>
                <AddressAutocompleteInput
                  inputStyle={[localStyles.fieldInput, focusedField === 'address' && localStyles.fieldInputFocused]}
                  onBlur={() => setFocusedField(null)}
                  onChangeText={(value) => setAddress(toTitleCase(value))}
                  onFocus={() => setFocusedField('address')}
                  onResolvedLocation={setAddressPlace}
                  placeholder="123 Main St, Suburb"
                  value={address}
                />
                {addrErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{addrErr}</Text>}

                <Text style={[localStyles.fieldLabel, { marginTop: 16 }]}>Route Preview</Text>
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
        <Text style={localStyles.headerTitle}>Trip Details</Text>
        {progressIndicator}
      </View>

      <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
          <ScrollView
            contentContainerStyle={localStyles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={localStyles.card}>
              <Text style={localStyles.cardLabel}>When</Text>
              <Text style={localStyles.fieldLabel}>Travel Date</Text>
              <Text style={localStyles.fieldHint}>Up to {BOOKING_HORIZON_DAYS} days ahead.</Text>
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
                <Ionicons color={colors.whiteA60} name="calendar-outline" size={18} />
              </Pressable>
              {travelDateErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{travelDateErr}</Text>}

              <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Earliest Departure</Text>
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
                <Ionicons color={colors.whiteA60} name="time-outline" size={18} />
              </Pressable>
              {depTimeErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{depTimeErr}</Text>}

              <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Latest Arrival</Text>
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
                <Ionicons color={colors.whiteA60} name="time-outline" size={18} />
              </Pressable>
              {arrTimeErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{arrTimeErr}</Text>}
              {arrTimeErr === '' && timeOrderWarning !== '' && <Text style={localStyles.warningText}>{timeOrderWarning}</Text>}
            </View>

            {/* Drivers only. Riders are not asked for a detour tolerance - the
                matcher derives theirs from their own direct trip at match time
                (backend/server/matching/riderPolicy.ts). */}
            {isDriving && (
              <View style={localStyles.card}>
                <Text style={localStyles.cardLabel}>Driver Details</Text>
                <Text style={localStyles.fieldLabel}>Max Detour (mins)</Text>
                <Text style={localStyles.fieldHint}>
                  How much longer your trip can take to pick riders up.
                </Text>
                <NumberStepper max={120} min={0} onChange={setDetourTime} step={5} style={localStyles.fieldInput} value={detourTime} />
                {detourTimeErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{detourTimeErr}</Text>}
                {detourTimeErr === '' && detourWarning !== '' && <Text style={localStyles.warningText}>{detourWarning}</Text>}

                <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Seats Available</Text>
                {carSeats !== null && (
                  <Text style={localStyles.fieldHint}>Up to {carSeats} - the passenger seats in your car.</Text>
                )}
                <NumberStepper max={carSeats ?? MAX_CAR_SEATS} min={1} onChange={setNumSeats} style={localStyles.fieldInput} value={numSeats} />
                {numSeatsErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{numSeatsErr}</Text>}
              </View>
            )}

            <Pressable onPress={goToConfirm} style={localStyles.actionButton}>
              <Text style={styles.primaryButtonText}>Next</Text>
            </Pressable>
          </ScrollView>

          <DatePickerModal
            initialDate={parseDateAsStr(travelDate)}
            maxDate={latestBookingDate()}
            onClose={() => {
              setActivePicker(null);
              setFocusedField(null);
            }}
            onSelect={(date) => {
              setTravelDate(formatDateToStr(date));
              setActivePicker(null);
              setFocusedField(null);
            }}
            visible={activePicker === 'date'}
          />

          <TimePickerModal
            initialTime={depTime}
            label="Earliest Departure"
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
            label="Latest Arrival"
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
    borderBottomColor: colors.whiteA08,
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
    backgroundColor: colors.whiteA16,
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
    backgroundColor: colors.whiteA18,
  },
  progressSegmentActive: {
    backgroundColor: colors.white,
  },
  progressLabel: {
    marginTop: 8,
    color: colors.whiteA70,
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
    backgroundColor: colors.whiteA16,
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
  segmentOptionDisabled: {
    opacity: 0.5,
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
    color: colors.whiteA70,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  fieldHint: {
    color: colors.whiteA40,
    fontSize: 12,
    marginBottom: 8,
  },
  fieldInput: {
    borderColor: colors.whiteA30,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.white,
    backgroundColor: colors.whiteA10,
  },
  fieldInputFocused: {
    borderColor: colors.white,
    borderWidth: 2,
    backgroundColor: colors.whiteA18,
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
    color: colors.whiteA40,
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
    backgroundColor: colors.mediumBlueA45,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.whiteA20,
    paddingVertical: 9,
  },
  summaryLabel: {
    color: colors.whiteA75,
    fontSize: 13,
  },
  summaryValue: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  youTitle: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 16,
    color: colors.white,
  },
  youCarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  youDetail: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  youNote: {
    color: colors.whiteA75,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  infoCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    backgroundColor: colors.whiteA10,
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
