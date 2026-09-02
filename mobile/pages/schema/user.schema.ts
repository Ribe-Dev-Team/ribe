export type UserRole = 'driver' | 'passenger' | 'both';

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  phoneNumber: string;
  dob: string;
  degree: string | null;
  bio: string | null;
  profilePhotoUrl: string | null;
  onboardingComplete: boolean;
  role: UserRole;
  totalCO2SavedKg: number;
  activeBookings: string[];
  confirmedBooking: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserProfileDraft {
  name?: string | null;
  dob?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  degree?: string | null;
  bio?: string | null;
  profilePhotoUrl?: string | null;
  onboardingComplete?: boolean;
}
