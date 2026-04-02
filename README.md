# AutoAttend AI v2.0

A complete college attendance system with Face Recognition, QR codes, Bluetooth proximity, and GPS verification.

---

## Prerequisites

- Python 3.11+
- Node.js 20+
- PostgreSQL 16+
- Expo CLI (`npm install -g expo-cli`)

---

## 1. Install PostgreSQL Locally

**Windows:** Download from https://www.postgresql.org/download/windows/ and run the installer.

**macOS:**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Ubuntu/Debian:**
```bash
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

---

## 2. Create the Database

```bash
psql -U postgres
```

```sql
CREATE DATABASE autoattend_v2;
\q
```

---

## 3. Backend Setup

```bash
cd autoattend-v2/backend

# Create and activate virtual environment
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and fill in all required values:
- `DATABASE_URL` — your PostgreSQL connection string
- `SECRET_KEY` — generate with: `python -c "import secrets; print(secrets.token_hex(32))"`
- `AZURE_FACE_KEY` / `AZURE_FACE_ENDPOINT` — from Azure portal
- `MSG91_AUTH_KEY` — from MSG91 dashboard
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — from Twilio console
- `COLLEGE_NAME` — your institution name

### Run Database Migrations

```bash
alembic upgrade head
```

### Start Backend

```bash
uvicorn main:app --reload
```

API will be available at: http://localhost:8000  
Interactive docs: http://localhost:8000/docs

---

## 4. Frontend Setup

```bash
cd autoattend-v2/frontend

npm install
npm start
```

Web app will be available at: http://localhost:3000

---

## 5. Mobile App Setup

```bash
cd autoattend-v2/AutoAttendMobile

npm install
expo start
```

- Press `a` to open on Android emulator
- Press `i` to open on iOS simulator
- Scan the QR code with the **Expo Go** app on a physical device

---

## Tech Stack

| Layer        | Technology                              |
|--------------|-----------------------------------------|
| Backend      | FastAPI + SQLAlchemy + PostgreSQL        |
| Frontend     | React 18 + Tailwind CSS + React Router v6|
| Mobile       | React Native (Expo SDK 54)               |
| Face API     | Azure Face API (Cognitive Services)      |
| OTP          | MSG91 (SMS + Email)                     |
| Auth         | JWT (HS256, 8hr) + TOTP (pyotp)         |
| Passwords    | Argon2id                                |
| QR Codes     | python-qrcode (backend generates)       |
| Alerts       | Twilio WhatsApp + MSG91                 |
| Reports      | ReportLab (PDF) + openpyxl (Excel)      |
| Scheduler    | APScheduler                             |

---

## Roles

| Role      | Access Scope                              |
|-----------|-------------------------------------------|
| principal | Entire college — all departments          |
| hod       | Their department only                     |
| teacher   | Their assigned subjects only              |
| student   | Their own data only                       |

---

## Project Structure

```
autoattend-v2/
├── backend/          # FastAPI application
├── frontend/         # React web application
└── AutoAttendMobile/ # React Native Expo mobile app
```
