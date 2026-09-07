export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const namePattern = /^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[ '-][A-Za-zÀ-ÖØ-öø-ÿ]+)*$/;
export const phonePattern = /^\+?[0-9()\- ]{10,15}$/;
export const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export const isValidEmail = (value: string) => emailPattern.test(value.trim());
export const isValidName = (value: string) => value.trim().length >= 2 && namePattern.test(value.trim());
export const isValidPhoneNumber = (value: string) => {
  const digitsOnly = value.replace(/\D/g, '');
  return phonePattern.test(value) && digitsOnly.length >= 10 && digitsOnly.length <= 15;
};

export const isValidDob = (value: string) => {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return false;

  const [day, month, year] = value.split('/').map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return false;
  }

  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > date.getMonth() ||
    (today.getMonth() === date.getMonth() && today.getDate() >= date.getDate());

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  return age >= 18;
};

export const isValidPassword = (value: string) => passwordPattern.test(value);
