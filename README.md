# Ribe
FIT3162 Project

- React Native + TypeScript frontend in the mobile folder
- Meteor backend in the backend folder
- Expo Go-friendly development flow for mobile testing

## Run locally

1. Start the Meteor backend
   - cd backend
   - meteor run --port 3000

2. Start the Expo frontend
   - cd mobile
   - npm start

3. Open the Expo QR code in Expo Go on your phone, or use the web preview.

For Expo Go on a physical device, replace the API URL in mobile/App.tsx with your computer's LAN IP if you want the app to call the Meteor backend.
