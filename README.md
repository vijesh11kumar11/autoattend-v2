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

---

## 📚 ClassPulse — Session-Aware Learning Space

ClassPulse extends AutoAttend with a tightly access-controlled content layer: teachers publish "capsules" (notes / voice / quiz), AI generates summaries + 3-question comprehension checks, students unlock material based on attendance, and HOD/Principal get department-wide intelligence.

### Concepts

| Term            | Meaning                                                       |
|-----------------|---------------------------------------------------------------|
| **Capsule**     | One unit of teacher-published material (PDF / voice / wall)   |
| **Unlock mode** | `always` · `after_attendance_marked` · `session_active` · `attendance_gated` |
| **Comprehension check** | AI-generated 3-Q MCQ (pass = 2/3, up to 2 attempts, 24h cooldown) |
| **Class Wall**  | Anonymous doubt board, AI auto-answers small queries          |
| **Featured**    | HOD-promoted capsule shown at the top of student feed         |

### Access Layers (fail-safe DENY)

1. Section enrollment (course + semester + section)
2. `Capsule.unlock_mode`
3. Live attendance state (today's session + present)
4. Cumulative attendance % vs `min_attendance_pct`
5. Suspicious-activity flagging (rapid quiz / IP changes / bulk download)

### Integrations with Core AutoAttend

| Trigger                       | ClassPulse reaction                                           |
|-------------------------------|---------------------------------------------------------------|
| Attendance session **start**  | Push `session_active` capsule unlock notice to enrolled       |
| Student marked **present**    | Push `after_attendance_marked` capsule unlock notice          |
| Attendance session **end**    | Push lock notice for `session_active` capsules                |
| TWM session report            | Includes 7-day ClassPulse engagement + most-failed capsule    |
| HOD dashboard                 | `classpulse_summary` widget (engagement, comprehension, gaps) |
| Quiz fail (3+ in 7d / subject)| Push escalation to HOD; tutor gets WhatsApp + SMS + push      |

### Key Endpoints (prefix `/api/classpulse`)

**Teacher**
- `POST /teacher/upload`               — create capsule (file or voice)
- `POST /teacher/capsule/{id}/reprocess-ai` — re-run AI summary + quiz
- `GET  /teacher/dashboard`            — recent activity, attention list

**Student**
- `GET  /student/subject/{id}/capsules`
- `POST /student/capsule/{id}/submit-quiz` — up to 2 attempts, 24h cooldown
- `GET  /student/capsule/{id}/quiz-retry-status`
- `GET  /student/my-progress`          — per-subject + overall + learning streak

**HOD / Principal**
- `GET  /hod/department-analytics`
- `GET  /hod/subject/{id}/full-report`
- `POST /hod/capsule/{id}/feature`     — toggle ⭐ Featured

### Quiz Retry Policy

- `QUIZ_MAX_ATTEMPTS = 2`
- `QUIZ_RETRY_COOLDOWN_HOURS = 24`
- Pass threshold: 2 / 3 (`QUIZ_PASS_SCORE`)
- After max attempts (failed): tutor + HOD notified, capsule remains read-only

### Migrations

- `classpulse_001` — capsules, interactions, wall posts, access logs
- `classpulse_002` — `featured / featured_by / featured_at` + `quiz_attempts_count / last_quiz_at`

### Seed

`python seed.py` now provisions 3 sample capsules (one per subject) with valid AI summary + quiz JSON. The first is marked **featured** to exercise the HOD spotlight UI.
