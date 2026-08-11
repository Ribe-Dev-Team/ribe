# Ribe

## About the Project

Ribe is a student project developed for **FIT3161/FIT3162**. 

Our project aims to build a Minimum Viable Product (MVP): a ridesharing application enabling Monash students to find and coordinate trips to and from the Clayton campus, reducing travel costs and improving transport access amid heightened demand for affordable, sustainable travel. 

## Team Members

<table>
    <tbody>
        <tr>
            <td align="center" valign="top" width="14.28%">
                <a href="https://github.com/kamlesa">
                <img src="https://avatars.githubusercontent.com/u/117716223?v=4" width="100px;"/><br />
                <sub><b style="font-size:18px;">Anika</b></sub></a>
                <br><p>Project Manager</p></br>
            </td>
            <td align="center" valign="top" width="14.28%">
                <a href="https://github.com/irisneerakal98-arch">
                <img src="https://avatars.githubusercontent.com/u/266628203?v=4" width="100px;"/><br />
                <sub><b style="font-size:18px;">Iris</b></sub></a>
                <br><p>UI/UX and Frontend Lead</p></br>
            </td>
            <td align="center" valign="top" width="14.28%">
                <a href="https://github.com/ClarkY168">
                <img src="https://avatars.githubusercontent.com/u/201672870?v=4" width="100px;" /><br />
                <sub><b style="font-size:18px;">Clark</b></sub></a>
                <br><p>Backend Development Lead</p></br>
            </td>
            <td align="center" valign="top" width="14.28%">
                <a href="https://github.com/sourcecodemorsecode">
                <img src="https://avatars.githubusercontent.com/u/115714918?v=4" width="100px;"/><br />
                <sub><b style="font-size:18px;">David</b></sub></a>
                <br><p>Quality Assurance Lead</p></br>
            </td>
        </tr>
  </tbody>
</table>

## Tech Stack

- **Frontend:** React Native + TypeScript
- **Backend:** Meteor
- **Mobile Development:** Expo Go
- **Frontend location:** `mobile/`
- **Backend location:** `backend/`

## Setup & Running

### First-Time Setup

Navigate to the `backend` and `mobile` folders and install the required dependencies:

```bash
cd backend
npm install

cd ../mobile
npm install
```

### Run Locally

#### 1. Start the Meteor Backend

    cd backend

    meteor run --port 3000

#### 2. Start the Expo Frontend

In a separate terminal:

    cd mobile

    npm start

#### 3. Open the Application

The Expo development server will display a QR code.

- Scan the QR code using **Expo Go** on a physical device.

- Alternatively, use the available web preview.

> **Note:** When using Expo Go on a physical device, update the API URL in `mobile/App.tsx` to use your computer's **LAN IP address** so that the mobile application can communicate with the Meteor backend.