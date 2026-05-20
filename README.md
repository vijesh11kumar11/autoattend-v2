# AutoAttend AI v2.0

A production-ready college attendance management system combining **Face Recognition**, **rotating QR codes**, **GPS verification**, and **Bluetooth proximity** into a single anti-proxy attendance pipeline. Built for three client surfaces: a FastAPI backend, a React web dashboard, and a React Native Expo mobile app.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Database Schema](#database-schema)
5. [Role Hierarchy & Access Scopes](#role-hierarchy--access-scopes)
6. [Core Features](#core-features)
7. [API Reference](#api-reference)
8. [Background Jobs (APScheduler)](#background-jobs-apscheduler)
9. [ClassPulse — Session-Aware Learning Space](#-classpulse--session-aware-learning-space)
10. [Frontend (Web) — Page Map](#frontend-web--page-map)
11. [Mobile App — Screen Map](#mobile-app--screen-map)
12. [Security Architecture](#security-architecture)
13. [Notification Channels](#notification-channels)
14. [Environment Variables](#environment-variables)
15. [Prerequisites](#prerequisites)
16. [Local Setup](#local-setup)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Client Layer                              │
│  ┌──────────────────┐  ┌─────────────────────────────────────┐  │
│  │  React Web App   │  │  React Native Mobile App (Expo 54)  │  │
│  │  (Vite + Tailwind│  │  iOS · Android                      │  │
│  │   React Router 6)│  │  Camera · BLE · GPS · Push Notif.   │  │
│  └────────┬─────────┘  └─────────────┬───────────────────────┘  │
└───────────┼─────────────────────────┼────────────────────────────┘
            │ REST / JSON (JWT Bearer) │
┌───────────▼─────────────────────────▼────────────────────────────┐
│                     FastAPI Backend (Python 3.11)                 │
│  Rate-limited (slowapi) · CORS-guarded · Structured logging       │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                     Route Modules                        │    │
│  │  auth · face · attendance · qr · students · faculty      │    │
│  │  reports · alerts · users · sections · tutor · timetable │    │
│  │  twm · leave · analytics · student_portal · feed         │    │
│  │  career · suggestions · classpulse                       │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │   SQLAlchemy   │  │  APScheduler │  │  External Services  │  │
│  │   ORM (sync)   │  │  (background │  │  Azure Face API     │  │
│  │   psycopg2     │  │   jobs)      │  │  Twilio WhatsApp    │  │
│  └───────┬────────┘  └──────────────┘  │  MSG91 SMS/Email    │  │
│          │                             │  Fast2SMS           │  │
└──────────┼─────────────────────────────│  Expo Push          │  │
           │                             │  NewsAPI            │  │
┌──────────▼──────────┐                  │  Gemini / Groq AI   │  │
│   PostgreSQL 16      │                 └─────────────────────┘  │
│  26 tables · JSONB   │                                           │
└──────────────────────┘                                           │
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI 0.115 + SQLAlchemy 2.0 + PostgreSQL 16 |
| ORM driver | psycopg2-binary (sync) + asyncpg (async URL kept for migrations) |
| Migrations | Alembic 1.13 |
| Frontend | React 18 + Vite 5 + Tailwind CSS 3 + React Router v6 |
| Mobile | React Native 0.76 · Expo SDK 54 |
| Face Recognition | Azure Cognitive Services Face API (recognition_04 + detection_03) |
| Liveness detection | Challenge-response (blink · smile · turn_left · turn_right · open_mouth) |
| QR codes | python-qrcode (5-second rotating HMAC tokens) |
| GPS verification | Haversine distance check ≤ 50 m (configurable) |
| Bluetooth | react-native-ble-plx on mobile · token-based verification on backend |
| Auth | JWT HS256 (8 hr expiry) + TOTP 2FA via pyotp |
| Password hashing | Argon2id (time_cost=3, memory=64MB, parallelism=2) |
| OTP | MSG91 SMS + Email (password reset, device change, face re-enroll) |
| Push notifications | Expo Push Notification Service (exponent_server_sdk) |
| WhatsApp alerts | Twilio WhatsApp API |
| SMS alerts | Fast2SMS |
| PDF reports | ReportLab + PyMuPDF (watermarked downloads) |
| Excel reports | openpyxl |
| AI — ClassPulse | Gemini API / Groq API (summaries + quiz generation + suggestion analysis) |
| AI — Career | Gemini API / Groq API (personalised career roadmaps) |
| News feed | NewsAPI with 60-min in-memory cache |
| Rate limiting | slowapi (per-IP) |
| Background jobs | APScheduler (BackgroundScheduler) |
| Charts (web) | Recharts |
| PDF viewer (web) | pdfjs-dist |

---

## Project Structure

```
autoattend-v2/
├── backend/
│   ├── main.py                  # FastAPI app factory + router registration + scheduler
│   ├── config.py                # Pydantic Settings — all env vars with defaults
│   ├── database.py              # SQLAlchemy models (26 tables), enums, engine, get_db()
│   ├── alembic/                 # Database migration scripts
│   ├── routes/
│   │   ├── auth.py              # Login, TOTP, OTP password-reset, device-change
│   │   ├── attendance.py        # Session lifecycle + multi-factor mark + manual override
│   │   ├── face.py              # Enroll, verify, re-enroll, liveness challenge
│   │   ├── qr.py                # QR token generate + validate
│   │   ├── students.py          # Student CRUD + face enrollment status
│   │   ├── faculty.py           # Faculty CRUD + subject assignment
│   │   ├── sections.py          # Section CRUD + enrollment
│   │   ├── timetable.py         # Timetable CRUD (incl. TWM + lab entries)
│   │   ├── tutor.py             # Tutor assignment + ward management
│   │   ├── twm.py               # Tutor Ward Meeting sessions + attendance
│   │   ├── leave.py             # Leave application + approve/reject + auto-update attendance
│   │   ├── reports.py           # Student PDF · class PDF · defaulters PDF · monthly Excel
│   │   ├── alerts.py            # Alert log query + manual trigger
│   │   ├── analytics.py         # Anomaly flags · subject health score · forecast · semester progress
│   │   ├── student_portal.py    # Student dashboard · forecast · disputes · timetable
│   │   ├── users.py             # User profile + push-token registration + device approval
│   │   ├── feed.py              # News feed (NewsAPI, categorised, cached)
│   │   ├── career.py            # AI career roadmap generate + save/list
│   │   ├── suggestions.py       # Anonymous suggestion box + AI analysis
│   │   └── classpulse.py        # ClassPulse — capsule CRUD + quiz + wall + analytics
│   ├── schemas/
│   │   ├── attendance_schemas.py
│   │   ├── auth_schemas.py
│   │   ├── faculty_schemas.py
│   │   └── student_schemas.py
│   ├── utils/
│   │   ├── auth_utils.py        # JWT issue/validate, role guards (student_only, teacher_or_above …)
│   │   ├── face_utils.py        # Azure Face client, PersonGroup, identify, liveness
│   │   ├── qr_utils.py          # HMAC QR token generation + validation
│   │   ├── location_utils.py    # Haversine GPS check + Bluetooth proximity verify
│   │   ├── bluetooth_utils.py   # Bluetooth token generation
│   │   ├── otp_utils.py         # MSG91 OTP send (SMS + email) + verify
│   │   ├── notification_utils.py# Expo push single + bulk
│   │   ├── sms.py               # Fast2SMS notification wrapper
│   │   ├── whatsapp.py          # Twilio WhatsApp wrapper
│   │   ├── pdf_generator.py     # ReportLab PDF builders + openpyxl Excel
│   │   ├── pdf_watermark.py     # PyMuPDF watermark stamper
│   │   ├── signed_urls.py       # Signed download URL helper
│   │   ├── classpulse_access.py # ClassPulse multi-layer access gate
│   │   └── classpulse_ai.py     # Gemini/Groq capsule summary + quiz generation
│   ├── requirements.txt
│   ├── seed.py                  # Sample data (college, dept, course, section, users, capsules)
│   └── seed_test_data.py        # Extended test data
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Route tree + PrivateRoute + RoleRedirect
│   │   ├── context/AuthContext.jsx
│   │   ├── api/                 # Axios wrappers per domain
│   │   ├── components/          # Shared UI components
│   │   └── pages/
│   │       ├── LoginPage.jsx
│   │       ├── ForgotPasswordPage.jsx
│   │       ├── TOTPSetupPage.jsx
│   │       ├── principal/       # PrincipalDashboard, Departments, Reports, Audit, Alerts, ClassPulse
│   │       ├── hod/             # HODDashboard, Sections, Subjects, Teachers, Students,
│   │       │                    #   Reports, Analytics, Alerts, Timetable, TutorMgmt, ClassPulse
│   │       ├── teacher/         # TeacherDashboard, Attendance, GenerateQR, Reports,
│   │       │                    #   TWM, Leave, Analytics, Disputes, ClassPulse, SubjectAnalytics
│   │       └── student/         # StudentDashboard, ScanQR, FaceEnrollment, ClassPulse
│   └── package.json
│
└── AutoAttendMobile/
    ├── App.js                   # Startup ping + push registration + ErrorBoundary
    ├── src/
    │   ├── config.js            # API_BASE_URL
    │   ├── context/AuthContext.js
    │   ├── navigation/AppNavigator.js
    │   ├── api/                 # Axios wrappers
    │   ├── components/          # ErrorBoundary, OfflineBanner, shared UI
    │   ├── utils/notifications.js
    │   └── screens/
    │       ├── auth/            # LoginScreen, TOTPScreen, ForgotPasswordScreen, FaceSetupScreen
    │       ├── student/         # StudentDashboard, ScanQRScreen, AttendanceHistory,
    │       │                    #   TimetableScreen, ClassPulseMobileScreen
    │       ├── teacher/         # TeacherDashboard, ClassesScreen, QRGenerateScreen,
    │       │                    #   TeacherReportsScreen, TeacherClassPulseMobileScreen
    │       └── hod/             # HODDashboard, DeptOverviewScreen, HODReportsScreen,
    │                            #   PendingApprovalsScreen, StudentsScreen, TeachersScreen
    └── package.json
```

---

## Database Schema

The system uses **26 tables** in PostgreSQL 16. All timestamps are UTC.

### Organizational hierarchy

| Table | Purpose |
|---|---|
| `colleges` | Root entity — name, address, logo |
| `departments` | Belongs to a college (unique code per college) |
| `courses` | Belongs to a department (e.g., B.E. CSE) |
| `sections` | Subdivision of course+semester (A / B / C …) |
| `subjects` | Belongs to a course, assigned to one teacher, per semester |

### Users & devices

| Table | Purpose |
|---|---|
| `users` | Single table for all roles (principal · hod · teacher · student). Holds password hash, TOTP secret, Azure person ID, push token, parent contact |
| `device_registry` | One device per user (device binding) — approved by HOD/admin |
| `otp_log` | Hashed OTP records with purpose (password_reset · device_change · face_reenroll · email_verify · phone_verify) and channel |
| `face_change_log` | Audit trail every time a student's face data is updated |
| `liveness_challenges` | Per-student challenge issued before face verify (blink / smile / turn_left / turn_right / open_mouth) |

### Timetable

| Table | Purpose |
|---|---|
| `timetable` | Weekly schedule entries per teacher+section. Supports lab slots (`is_lab`), TWM periods (`is_twm`), color tags |

### Attendance pipeline

| Table | Purpose |
|---|---|
| `attendance_sessions` | One session per subject+date+section. Holds GPS anchor, Bluetooth token, QR secret, session status (active · ended · expired) |
| `qr_tokens` | 5-second rotating HMAC tokens — one slot per time window, single-use |
| `face_verify_tokens` | Short-lived (60 s) token issued after successful face verify; must be presented at QR scan |
| `attendance_records` | Final attendance per student per session (present · absent · late · medical_leave · duty_leave). Stores face/GPS/Bluetooth flags |
| `attendance_audit` | Every mark attempt (success + failure) with confidence score, GPS distance, device ID, IP |
| `attendance_disputes` | Students dispute an absent mark; resolved by teacher/HOD |

### Tutor Ward Meeting (TWM)

| Table | Purpose |
|---|---|
| `tutor_assignments` | Links a teacher-tutor to their ward students for an academic year |
| `twm_sessions` | TWM session records (tutor + date + notes) |
| `twm_attendance` | Per-student attendance for each TWM session |

### Leave management

| Table | Purpose |
|---|---|
| `leave_requests` | Student leave applications (medical · duty · personal · emergency · sports · other). Auto-updates attendance records on approval |

### Reporting & communications

| Table | Purpose |
|---|---|
| `alerts_log` | Every WhatsApp / SMS / email alert sent, with status and external ID |

### AI & engagement

| Table | Purpose |
|---|---|
| `career_roadmaps` | AI-generated career plans stored per user (JSONB payload) |
| `suggestions` | Anonymous feedback from any role — categorised, prioritised, sentiment-tagged |
| `suggestion_ai_reports` | AI-generated analysis reports over batches of suggestions (JSONB) |

### ClassPulse tables

| Table | Purpose |
|---|---|
| `capsules` | Learning material units (notes · slides · reference · assignment_material · lab_manual · previous_year · formula_sheet). Holds file URL, voice memo, AI summary, AI quiz JSON, unlock mode |
| `capsule_interactions` | Per-student per-capsule engagement tracker (pages viewed, time spent, completion %, quiz score, download status, quiz retry counters) |
| `class_wall_posts` | Anonymous doubt board per subject/section. Holds AI suggested answer, teacher answer, resonance count, hot flag |
| `class_wall_resonances` | "Me too" reactions on wall posts (one per student per post) |
| `capsule_access_logs` | Full audit of every view/download/quiz attempt (granted + denied) with deny reason and IP |

---

## Role Hierarchy & Access Scopes

```
principal
  └── hod (scoped to their department)
        └── teacher (scoped to their assigned subjects)
              └── student (own data only)
```

| Role | Capabilities |
|---|---|
| **principal** | Full college view — all departments, all reports, college-wide audit, alerts management, ClassPulse institution analytics |
| **hod** | Department scope — manage teachers, students, sections, subjects, timetable, reports, attendance analytics, tutor assignments, leave approvals, ClassPulse department analytics, suggestion analysis |
| **teacher** | Own subjects — start/end attendance sessions, generate QR, manual override, view reports, TWM sessions, leave request management, attendance dispute resolution, ClassPulse capsule management |
| **student** | Own data — scan QR to mark attendance, view own attendance/timetable/forecast, submit leave requests, dispute attendance, ClassPulse content access gated by attendance |

Enforced in `utils/auth_utils.py` via FastAPI dependencies: `student_only`, `teacher_or_above`, `hod_or_above`, `any_authenticated`.

---

## Core Features

### 1. Multi-Factor Attendance Marking

Students must pass up to four layers before attendance is recorded as `present`:

1. **Face Recognition** — Azure Face API `identify` call against the college PersonGroup (confidence ≥ 0.80, recognition model `recognition_04`). A liveness challenge (blink / smile / turn) is issued and validated first to prevent photo spoofing. On success, a 60-second `FaceVerifyToken` is issued.
2. **QR Code** — The teacher's device displays a rotating QR code that changes every 5 seconds (HMAC-SHA256 over `session_id + time_slot`). The student scans it and submits the `FaceVerifyToken` alongside. Single-use tokens prevent replay.
3. **GPS** — Student's reported coordinates are compared to the teacher's recorded anchor point. Distance must be within `GPS_RADIUS_METERS` (default 50 m).
4. **Bluetooth** (optional, controlled by `BLUETOOTH_REQUIRED`) — BLE scan on the mobile confirms proximity via a session-specific Bluetooth token broadcast by the teacher's device.

All check results (face confidence, GPS distance, Bluetooth flag) are persisted in `attendance_audit` for every attempt.

### 2. Attendance Session Lifecycle

```
Teacher: POST /api/attendance/start-session
  ↓  (records GPS anchor, generates QR secret, issues Bluetooth token)
  ↓  (pushes session_active ClassPulse unlock notices to enrolled students)
Students scan QR → attendance marked present
  ↓  (pushes after_attendance_marked ClassPulse unlock notices)
Teacher: POST /api/attendance/end-session/{id}
  ↓  (all un-marked students auto-marked absent)
  ↓  (pushes session_active capsule lock notices)
APScheduler: auto_expire_sessions() runs every 1 min
  ↓  (sessions open > their end_time are expired automatically)
```

### 3. Manual Override & Disputes

- Teachers / HOD can **manually override** any attendance record with a reason (recorded in `attendance_audit`).
- Students can **dispute** an absent mark via `POST /api/student/portal/dispute-attendance`. Disputes are reviewed by the teacher/HOD.

### 4. Leave Management

Students submit digital leave requests (with optional document URL). Tutors/HOD approve or reject with a note. On approval, attendance records in the leave date range are automatically updated to `medical_leave` or `duty_leave`.

**Types:** medical · duty · personal · emergency · sports · other  
**Policy (configurable):** max 14 days per request, documents required for medical + sports, backdating allowed up to 2 days.

### 5. Tutor Ward Meeting (TWM)

Each teacher can be designated as a **tutor** for a set of ward students (per academic year). TWM provides:
- Dedicated TWM session management (separate from subject attendance)
- Aggregated ward report — combines attendance from all subjects + ClassPulse engagement
- Personal report push to each ward student
- HOD oversight of all tutor dashboards

### 6. Reports

| Report | Format | Access |
|---|---|---|
| Individual student attendance | PDF | Teacher, HOD, Principal, Student (own) |
| Class session attendance | PDF | Teacher, HOD |
| Defaulters list (below threshold) | PDF | HOD, Principal |
| Monthly subject attendance | Excel | HOD, Principal |

Reports use **ReportLab** for PDF generation and **openpyxl** for Excel. Downloads from ClassPulse are watermarked with the student's name and roll number using **PyMuPDF**.

### 7. Analytics

| Endpoint | Consumer | Description |
|---|---|---|
| `GET /api/analytics/anomalies` | Teacher+ | Students with suspicious attendance patterns (sudden drops, consistent late marks) |
| `GET /api/analytics/subject-health/{id}` | Teacher+ | 0–100 health score for a subject based on attendance regularity |
| `GET /api/analytics/forecast/{student_id}` | Teacher+ | Per-subject attendance forecast — classes needed to reach/maintain threshold |
| `GET /api/analytics/semester-progress` | HOD+ | Department-wide semester attendance progress tracker |

The student portal also exposes `GET /api/student/portal/attendance-forecast` for students to see their own per-subject forecast.

### 8. News Feed

`GET /api/feed` returns paginated news articles from **NewsAPI** across five categories: jobs, education, AI, tech, and general. Results are cached in memory for 60 minutes (configurable). Full article detail at `GET /api/feed/article/{id}`.

### 9. AI Career Roadmap

`POST /api/career/generate` accepts a career goal, current skills, hours per week, and experience level. The backend calls **Gemini API** (with Groq as fallback) to produce a structured week-by-week roadmap stored as JSONB. Users can save and list their roadmaps.

### 10. Smart Suggestion Box

Any user (any role) can submit anonymous feedback via `POST /api/suggestions/submit`. Suggestions are categorised (teaching_quality · infrastructure · syllabus · administration · canteen · hostel · sports · library · other · class_environment · student_engagement), scoped (department / institution / subject / general), and sentiment-tagged. HODs and Principal trigger AI analysis reports via `POST /api/suggestions/generate-ai-report` (Gemini/Groq).

### 11. Device Binding

Each user is limited to one registered device (`device_registry` table). A new device request triggers an OTP verification and HOD approval before the new device is activated. This prevents shared-device proxy attacks.

---

## API Reference

All routes are prefixed under `/api`. Interactive docs at `/api/docs` (Swagger UI) and `/api/redoc`.

### Authentication — `/api/auth`

| Method | Path | Description |
|---|---|---|
| POST | `/login` | Email + password → JWT + user profile. TOTP challenge issued for teacher/hod/principal |
| POST | `/verify-totp` | Submit TOTP code to complete login |
| POST | `/setup-totp` | First-time TOTP secret provisioning (returns QR seed) |
| POST | `/refresh` | Refresh JWT token |
| POST | `/logout` | Invalidate session |
| POST | `/forgot-password/send-otp` | Send password-reset OTP via SMS or email |
| POST | `/forgot-password/verify-otp` | Verify OTP |
| POST | `/forgot-password/reset` | Set new password after OTP verified |
| POST | `/change-device/request` | Request device change — sends OTP |
| POST | `/change-device/confirm` | Confirm device change with OTP |

### Face — `/api/face`

| Method | Path | Description |
|---|---|---|
| POST | `/enroll` | Enroll a student's face (uploads image → Azure PersonGroup) |
| POST | `/verify` | Verify face for attendance → issues FaceVerifyToken |
| POST | `/liveness/challenge` | Request a liveness challenge (action to perform) |
| POST | `/liveness/verify` | Submit 3-frame response for liveness check |
| POST | `/re-enroll` | Re-enroll after OTP approval |
| DELETE | `/delete/{student_id}` | Remove face data (HOD/Principal only) |

### Attendance — `/api/attendance`

| Method | Path | Description |
|---|---|---|
| POST | `/start-session` | Start attendance session (teacher) — records GPS anchor + BT token |
| POST | `/mark` | Mark attendance (student) — validates face token + QR + GPS + BT |
| POST | `/end-session/{session_id}` | End session, auto-absent remaining students |
| GET | `/session/{session_id}` | Session status + attendance list |
| GET | `/student/{student_id}/summary` | Per-subject attendance summary |
| POST | `/manual-override` | Override a record (teacher/HOD) |
| GET | `/student/{student_id}/calendar` | Month-view attendance calendar |
| GET | `/student/{student_id}/recent` | Recent attendance records |

### QR — `/api/qr`

| Method | Path | Description |
|---|---|---|
| GET | `/generate/{session_id}` | Generate current QR payload (rotates every 5 s) |
| POST | `/validate` | Validate QR token (internal — called by attendance mark) |

### Students — `/api/students`

| Method | Path | Description |
|---|---|---|
| GET | `/` | List students (scoped by role) |
| POST | `/` | Create student (HOD/Principal) |
| GET | `/{id}` | Student detail |
| PUT | `/{id}` | Update student |
| DELETE | `/{id}` | Deactivate student |

### Faculty — `/api/faculty`

| Method | Path | Description |
|---|---|---|
| GET | `/` | List teachers/HODs |
| POST | `/` | Create faculty member |
| GET | `/{id}` | Faculty detail + subject list |
| PUT | `/{id}` | Update faculty |
| DELETE | `/{id}` | Deactivate faculty |

### Sections — `/api/sections`

| Method | Path | Description |
|---|---|---|
| GET | `/` | List sections (dept-scoped) |
| POST | `/` | Create section |
| PUT | `/{id}` | Update section |
| DELETE | `/{id}` | Delete section |
| POST | `/{id}/enroll` | Enroll students into section |

### Timetable — `/api/timetable`

| Method | Path | Description |
|---|---|---|
| GET | `/` | Weekly timetable (filtered by section/teacher) |
| POST | `/` | Create timetable entry |
| PUT | `/{id}` | Update entry |
| DELETE | `/{id}` | Delete entry |

### Tutor & TWM — `/api/tutor`, `/api/twm`

| Method | Path | Description |
|---|---|---|
| GET | `/tutor/assignments` | List tutor assignments |
| POST | `/tutor/assign` | Assign tutor to students |
| POST | `/twm/start` | Start TWM session |
| PUT | `/twm/{id}/mark-student` | Mark one student |
| POST | `/twm/{id}/mark-bulk` | Bulk mark students |
| POST | `/twm/{id}/mark-all-present` | Mark all present |
| POST | `/twm/{id}/end` | End TWM session |
| GET | `/twm/dashboard` | Tutor dashboard view |
| GET | `/twm/session/{id}/report` | Session report |
| GET | `/twm/ward-combined-report` | Aggregated ward attendance |
| POST | `/twm/send-report-to-ward` | Push personalised reports to ward |
| GET | `/twm/history` | Past TWM sessions |

### Leave — `/api/leave`

| Method | Path | Description |
|---|---|---|
| POST | `/apply` | Apply for leave (student) |
| GET | `/my-requests` | Own leave requests |
| DELETE | `/{id}/cancel` | Cancel pending request |
| GET | `/pending` | Pending requests (tutor/HOD) |
| GET | `/history` | Leave history with filters |
| POST | `/{id}/approve` | Approve + auto-update attendance |
| POST | `/{id}/reject` | Reject with note |
| GET | `/summary` | Dashboard counts |

### Reports — `/api/reports`

| Method | Path | Description |
|---|---|---|
| GET | `/student/{id}/pdf` | Individual student PDF report |
| GET | `/class/{session_id}/pdf` | Class session PDF report |
| GET | `/defaulters/pdf` | Defaulters list PDF |
| GET | `/monthly/{subject_id}/excel` | Monthly Excel report |
| GET | `/hod/students` | Student dropdown data |
| GET | `/hod/subjects` | Subject dropdown data |
| GET | `/hod/sessions` | Session dropdown data |
| GET | `/hod/defaulters` | Live defaulters JSON table |

### Analytics — `/api/analytics`

| Method | Path | Description |
|---|---|---|
| GET | `/anomalies` | Anomaly detection flags per subject |
| GET | `/subject-health/{id}` | 0-100 subject health score |
| GET | `/forecast/{student_id}` | Per-subject attendance forecast |
| GET | `/semester-progress` | Department semester progress |

### Student Portal — `/api/student/portal`, `/api/teacher/disputes`

| Method | Path | Description |
|---|---|---|
| GET | `/student/portal/dashboard` | Master student dashboard |
| GET | `/student/portal/attendance-forecast` | Own forecast |
| GET | `/student/portal/my-tutor` | Assigned tutor info |
| GET | `/student/portal/my-timetable` | Weekly timetable |
| POST | `/student/portal/dispute-attendance` | Submit attendance dispute |
| GET | `/student/portal/my-disputes` | List own disputes |
| GET | `/teacher/disputes/pending` | Pending disputes (teacher) |
| POST | `/teacher/disputes/{id}/resolve` | Resolve dispute |

### Alerts — `/api/alerts`

| Method | Path | Description |
|---|---|---|
| GET | `/` | Alert log (scoped by role) |
| POST | `/send` | Manually trigger alert |

### Users — `/api/users`

| Method | Path | Description |
|---|---|---|
| GET | `/me` | Current user profile |
| PUT | `/me` | Update profile |
| POST | `/push-token` | Register Expo push token |
| GET | `/device-approvals` | Pending device-change approvals (HOD) |
| POST | `/device-approvals/{id}/approve` | Approve device change |
| POST | `/device-approvals/{id}/reject` | Reject device change |

### News Feed — `/api/feed`

| Method | Path | Description |
|---|---|---|
| GET | `/` | Paginated news feed (all roles) |
| GET | `/article/{id}` | Single article detail |

### Career — `/api/career`

| Method | Path | Description |
|---|---|---|
| POST | `/generate` | Generate AI career roadmap |
| GET | `/saved` | List saved roadmaps |
| POST | `/save` | Save roadmap |

### Suggestions — `/api/suggestions`

| Method | Path | Description |
|---|---|---|
| POST | `/submit` | Submit anonymous feedback |
| GET | `/my-submissions` | Own submissions |
| GET | `/department-analysis` | Dept AI report + list (HOD, Principal) |
| GET | `/institution-analysis` | Institution AI report (Principal) |
| GET | `/teacher-feedback` | Anonymous student feedback (Teacher) |
| PATCH | `/{id}/respond` | Admin response (HOD, Principal) |
| POST | `/generate-ai-report` | Trigger AI analysis |

### ClassPulse — `/api/classpulse`

| Method | Path | Description |
|---|---|---|
| POST | `/teacher/upload` | Create capsule (file or voice memo) |
| PUT | `/teacher/capsule/{id}` | Update capsule metadata |
| DELETE | `/teacher/capsule/{id}` | Deactivate capsule |
| POST | `/teacher/capsule/{id}/reprocess-ai` | Re-run AI summary + quiz generation |
| GET | `/teacher/dashboard` | Recent activity, attention list |
| GET | `/student/subject/{id}/capsules` | Capsule list for a subject (access-gated) |
| POST | `/student/capsule/{id}/view` | Log view + track engagement |
| POST | `/student/capsule/{id}/download` | Request watermarked download |
| POST | `/student/capsule/{id}/submit-quiz` | Submit quiz answers (max 2 attempts, 24h cooldown) |
| GET | `/student/capsule/{id}/quiz-retry-status` | Check retry eligibility |
| GET | `/student/my-progress` | Per-subject + overall + learning streak |
| GET | `/student/wall/{subject_id}` | Class Wall posts |
| POST | `/student/wall/{subject_id}/post` | Post doubt to Class Wall |
| POST | `/student/wall/post/{id}/resonate` | +1 resonance |
| POST | `/teacher/wall/post/{id}/answer` | Teacher answer |
| GET | `/hod/department-analytics` | HOD department ClassPulse analytics |
| GET | `/hod/subject/{id}/full-report` | Per-subject full report |
| POST | `/hod/capsule/{id}/feature` | Toggle ⭐ Featured on capsule |
| GET | `/principal/institution-analytics` | Institution-wide ClassPulse analytics |

---

## Background Jobs (APScheduler)

Two jobs run in a `BackgroundScheduler` started at app startup:

| Job ID | Schedule | Action |
|---|---|---|
| `auto_expire` | Every 1 minute | Calls `auto_expire_sessions()` — expires `active` sessions whose `end_time` has passed; auto-marks remaining un-marked students as `absent` |
| `daily_alerts` | Daily at 20:00 | Queries per-student per-subject attendance %; sends Expo push notification to any student below `ATTENDANCE_THRESHOLD` with the number of extra classes needed |

---

## 📚 ClassPulse — Session-Aware Learning Space

ClassPulse is an attendance-integrated content layer built into AutoAttend. Teachers publish **capsules** (PDF notes, slides, assignments, lab manuals, formula sheets, voice memos); the AI generates a summary and a 3-question MCQ comprehension check. Student access to each capsule is gated by attendance state.

### Capsule types

`notes` · `slides` · `reference` · `assignment_material` · `lab_manual` · `previous_year` · `formula_sheet`

### Unlock modes

| Mode | When content unlocks |
|---|---|
| `always` | Always accessible to enrolled students |
| `session_active` | Only while today's session is active |
| `after_attendance_marked` | Only after student is marked present in today's session |
| `attendance_gated` | Only when cumulative attendance ≥ `min_attendance_pct` |

### Access layers (fail-safe DENY)

1. Section enrollment (course + semester + section)
2. `Capsule.unlock_mode` check
3. Live attendance state (today's session + present flag)
4. Cumulative attendance % vs `min_attendance_pct`
5. Suspicious-activity flagging (rapid quiz / IP changes / bulk download)

### Class Wall

An anonymous doubt board per subject+section. Students post questions; AI auto-suggests an answer (`ai_suggested_answer` + confidence score). Teachers can post official answers. Other students can resonate (+1) to surface hot questions. Wall posts cycle through statuses: `open → answered → resolved → escalated`.

### Quiz retry policy

- Max attempts: **2**
- Cooldown between attempts: **24 hours**
- Pass threshold: **2 / 3** correct
- On max attempts failed: tutor + HOD are notified via push; capsule remains read-only for that student

### HOD Featured

HODs can toggle a `⭐ Featured` flag on any capsule via `POST /api/classpulse/hod/capsule/{id}/feature`. Featured capsules appear at the top of the student feed for that subject.

### Cross-system integrations

| Trigger | ClassPulse reaction |
|---|---|
| Attendance session **start** | Push `session_active` capsule unlock notice to enrolled students |
| Student marked **present** | Push `after_attendance_marked` capsule unlock notice |
| Attendance session **end** | Push lock notice for `session_active` capsules |
| TWM session report | Includes 7-day ClassPulse engagement + most-failed capsule |
| HOD dashboard | `classpulse_summary` widget (engagement, comprehension, learning gaps) |
| Quiz fail (3+ in 7 days / subject) | Escalation push to HOD; tutor notified via WhatsApp + SMS + push |

---

## Frontend (Web) — Page Map

### Principal (`/principal/*`)

- **PrincipalDashboard** — college-wide stats
- **DepartmentsPage** — manage departments
- **CollegeReportsPage** — institution-level reports
- **PrincipalAuditPage** — full attendance audit log
- **PrincipalAlertsPage** — alert history and triggers
- **PrincipalClassPulsePage** — institution-wide ClassPulse analytics

### HOD (`/hod/*`)

- **HODDashboard** — department overview
- **StudentsPage** — student list + management
- **TeachersPage** — teacher list + management
- **SubjectsPage** — subject assignment
- **SectionsPage** — section management + enrollment
- **TimetablePage** — department timetable
- **TutorManagementPage** — assign/manage tutors
- **TutorOverviewPage** — all tutor dashboards
- **DeptReportsPage** — department reports
- **SectionAnalyticsPage** — per-section attendance analytics
- **SemesterProgressPage** — semester progress tracker
- **TeacherPerformancePage** — teacher performance metrics
- **AlertsPage** — department alert log
- **HODDisputesPage** — dispute review
- **HODClassPulsePage** — department ClassPulse analytics

### Teacher (`/teacher/*`)

- **TeacherDashboard** — today's schedule + quick stats
- **TeacherHomePage** — home view
- **MyClassesPage** — subject list
- **AttendancePage** — start/manage/end session
- **GenerateQRPage** — live rotating QR display
- **TeacherReportsPage** — class and student reports
- **TWMPage** — Tutor Ward Meeting management
- **LeaveRequestsPage** — approve/reject leave requests
- **SubjectAnalyticsPage** — per-subject attendance analytics
- **TeacherDisputesPage** — dispute resolution
- **TutorDashboardPage** — tutor ward overview
- **ClassPulsePage** — capsule management

### Student (`/student/*`)

- **StudentDashboard** — attendance summary + news feed + ClassPulse feed
- **ScanQRPage** — camera-based QR scanner
- **FaceEnrollmentPage** — first-time face capture (required before any other page)
- **StudentClassPulsePage** — capsule browser + quiz + Class Wall

### Public

- **LoginPage** — email + password; TOTP modal for staff
- **ForgotPasswordPage** — OTP-based password reset
- **TOTPSetupPage** — first-time TOTP provisioning (QR seed)

---

## Mobile App — Screen Map

### Auth

- **LoginScreen** — email + password login
- **TOTPScreen** — 6-digit TOTP code entry
- **ForgotPasswordScreen** — OTP reset flow
- **FaceSetupScreen** — initial face capture

### Student

- **StudentDashboard** — attendance stats, subject list
- **ScanQRScreen** — camera → QR decode → attendance mark
- **AttendanceHistoryScreen** — calendar + list view
- **TimetableScreen** — weekly timetable view
- **ClassPulseMobileScreen** — capsule list + quiz + wall

### Teacher

- **TeacherDashboard** — today's classes
- **ClassesScreen** — subject + session management
- **QRGenerateScreen** — live rotating QR display
- **TeacherReportsScreen** — class reports
- **TeacherClassPulseMobileScreen** — capsule management

### HOD

- **HODDashboard** — department stats
- **DeptOverviewScreen** — section + subject overview
- **HODReportsScreen** — department reports
- **PendingApprovalsScreen** — device-change + leave approvals
- **StudentsScreen** — student directory
- **TeachersScreen** — teacher directory

---

## Security Architecture

| Concern | Mechanism |
|---|---|
| Password storage | Argon2id (time_cost=3, memory=64 MB, parallelism=2) |
| Session tokens | JWT HS256, 8-hour expiry |
| Staff 2FA | TOTP (pyotp, RFC 6238) — mandatory for teacher/hod/principal |
| TOTP brute-force | `totp_fail_count` + `totp_locked_until` — account locked after N failures |
| Attendance proxy | 4-layer check (face liveness + short-lived face token + rotating QR + GPS/BT) |
| QR replay | Single-use tokens with 5-second time-slot windows |
| Device binding | One device per user; device-change requires OTP + HOD approval |
| Face spoofing | Azure liveness challenge before every verify; stored in `liveness_challenges` |
| Data exfiltration | ClassPulse downloads watermarked with student identity (PyMuPDF) |
| Rate limiting | slowapi per-IP across all endpoints |
| CORS | Restricted to configured `FRONTEND_URL` + Vite dev server |
| Audit trail | `attendance_audit` (every attempt), `face_change_log` (every face update), `capsule_access_logs` (every capsule access) |

---

## Notification Channels

| Channel | Library | Used for |
|---|---|---|
| Push (mobile) | Expo Push (exponent_server_sdk) | Session start/end, attendance marked, low-attendance daily warning, leave approvals, device-change status, ClassPulse quiz escalation |
| WhatsApp | Twilio | Parent alerts for low attendance |
| SMS | Fast2SMS | Notification fallback |
| SMS/Email OTP | MSG91 | Password reset, device change, face re-enrollment, email/phone verify |

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in:

```env
# Database
DATABASE_URL=postgresql+asyncpg://postgres:PASSWORD@localhost:5432/autoattend_v2
DATABASE_URL_SYNC=postgresql+psycopg2://postgres:PASSWORD@localhost:5432/autoattend_v2

# JWT
SECRET_KEY=<generate: python -c "import secrets; print(secrets.token_hex(32))">
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_HOURS=8

# Argon2
ARGON2_TIME_COST=3
ARGON2_MEMORY_COST=65536
ARGON2_PARALLELISM=2

# TOTP
TOTP_ISSUER=AutoAttend AI

# Azure Face API
AZURE_FACE_ENDPOINT=https://centralindia.api.cognitive.microsoft.com/
AZURE_FACE_KEY=<your key>
AZURE_PERSON_GROUP_ID=autoattend_college

# MSG91 (OTP — SMS + Email)
MSG91_AUTH_KEY=<your key>
MSG91_SENDER_ID=ATTEND
MSG91_OTP_TEMPLATE_ID=<template id>
MSG91_EMAIL_TEMPLATE_ID=autoattend_email_otp
MSG91_EMAIL_FROM=noreply@autoattend.com
MSG91_EMAIL_DOMAIN=yourdomain.mailer91.com

# Fast2SMS (SMS notifications)
FAST2SMS_API_KEY=<your key>

# Twilio WhatsApp (parent alerts)
TWILIO_ACCOUNT_SID=<sid>
TWILIO_AUTH_TOKEN=<token>
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# AI (Career roadmap + suggestion analysis + ClassPulse)
GEMINI_API_KEY=<your key>
GROQ_API_KEY=<your key>

# News Feed
NEWS_API_KEY=<your key>
FEED_CACHE_MINUTES=60

# App
APP_NAME=AutoAttend AI
DEBUG=True
FRONTEND_URL=http://localhost:3000
COLLEGE_NAME=Your College Name

# Attendance rules
ATTENDANCE_THRESHOLD=75.0
QR_EXPIRY_SECONDS=5
FACE_VERIFY_TOKEN_EXPIRY_SECONDS=60
GPS_RADIUS_METERS=50.0
GPS_ACCURACY_THRESHOLD_METERS=50.0
BLUETOOTH_REQUIRED=False

# Leave policy
LEAVE_MAX_DAYS_PER_REQUEST=14
LEAVE_ALLOW_PAST_DATE_DAYS=2
LEAVE_DOCUMENT_REQUIRED_TYPES=medical,sports
```

---

## Prerequisites

- Python 3.11+
- Node.js 20+
- PostgreSQL 16+
- Expo CLI (`npm install -g expo-cli`)

---

## Local Setup

### 1. Install PostgreSQL

**Windows:** https://www.postgresql.org/download/windows/

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

### 2. Create the Database

```bash
psql -U postgres
```
```sql
CREATE DATABASE autoattend_v2;
\q
```

### 3. Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate        # macOS/Linux
venv\Scripts\activate           # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your values

# Run migrations
alembic upgrade head

# (Optional) Seed sample data
python seed.py

# Start server
uvicorn main:app --reload
```

API: http://localhost:8000  
Swagger docs: http://localhost:8000/api/docs  
ReDoc: http://localhost:8000/api/redoc

### 4. Frontend (Web)

```bash
cd frontend

npm install
npm start        # Vite dev server → http://localhost:5173
```

### 5. Mobile App

```bash
cd AutoAttendMobile

npm install
expo start
```

- Press `a` — Android emulator
- Press `i` — iOS simulator
- Scan QR — Expo Go on a physical device

Update `src/config.js` with your backend URL before running on a physical device.
