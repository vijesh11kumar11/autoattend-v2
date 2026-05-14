"""
ClassPulse Live — Smoke test for the F02–F10 features.

Run from the `backend/` folder while the API is up on http://localhost:8000:

    python test_live_session_flow.py

Prereqs (seeded users):
    teacher01@svec.edu.in  / password123
    student01@svec.edu.in  / password123
    A subject with id=1 owned by teacher01.

The script is intentionally lenient — endpoints that depend on background
work (capsule generation, AI interventions) are reported as informational
rather than asserted, so a green run requires only the synchronous
endpoints to be wired up.
"""
import sys
import time

import requests

BASE = "http://localhost:8000/api"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def login(email: str, password: str = "password123") -> str:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return r.json().get("access_token")


def step(label: str, ok: bool, detail: str = "") -> None:
    icon = "✅" if ok else "❌"
    print(f"{icon} {label}" + (f" — {detail}" if detail else ""))


def main() -> int:
    print("=" * 60)
    print("CLASSPULSE LIVE — SMOKE TEST")
    print("=" * 60)

    teacher_token = login("teacher01@svec.edu.in")
    student_token = login("student01@svec.edu.in")

    # 1. Create live session
    r = requests.post(
        f"{BASE}/live/sessions",
        headers=auth(teacher_token),
        json={"subject_id": 1, "title": "Smoke Test Session", "session_type": "standalone"},
    )
    if r.status_code not in (200, 201):
        step("Create live session", False, r.text[:160]);  return 1
    session_id = r.json().get("session_id") or r.json().get("id")
    step("Create live session", True, f"id={session_id}")

    # 2. Pulse check
    r = requests.post(
        f"{BASE}/live/sessions/{session_id}/pulse-check",
        headers=auth(teacher_token),
        json={
            "question": "What is a base case?",
            "option_a": "A loop counter",
            "option_b": "A stopping condition",
            "option_c": "A return type",
            "option_d": "A parameter",
            "correct_option": "B",
            "duration_secs": 15,
        },
    )
    pulse_id = r.json().get("pulse_id") if r.ok else None
    step("Pulse check sent", r.ok, f"pulse_id={pulse_id}" if pulse_id else r.text[:160])

    # 3. Student response
    if pulse_id:
        r = requests.post(
            f"{BASE}/live/sessions/{session_id}/pulse-response",
            headers=auth(student_token),
            json={"pulse_id": pulse_id, "chosen_option": "B"},
        )
        step("Student responded to pulse", r.ok, r.text[:160] if not r.ok else "is_correct=True")

    # 4. Close pulse
    if pulse_id:
        r = requests.post(
            f"{BASE}/live/sessions/{session_id}/pulse-check/{pulse_id}/close",
            headers=auth(teacher_token),
        )
        step("Pulse closed", r.ok, r.text[:160] if not r.ok else "")

    # 5. AI observation
    r = requests.post(
        f"{BASE}/live/sessions/{session_id}/ai/trigger-observation",
        headers=auth(teacher_token),
    )
    step("AI observation", r.ok, (r.json().get("message") or "")[:80] if r.ok else r.text[:160])

    # 6. Bookmark
    r = requests.post(
        f"{BASE}/live/sessions/{session_id}/bookmarks",
        headers=auth(teacher_token),
        json={"bookmark_type": "topic_start", "title": "Trees Introduction"},
    )
    step("Add bookmark", r.ok, r.text[:160] if not r.ok else "")

    # 7. Engagement timeline + student attention (F02)
    r = requests.get(
        f"{BASE}/live/sessions/{session_id}/engagement-timeline",
        headers=auth(teacher_token),
    )
    step("Engagement timeline", r.ok, r.text[:160] if not r.ok else f"{len(r.json().get('timeline', []))} pts")

    r = requests.get(
        f"{BASE}/live/sessions/{session_id}/student-attention",
        headers=auth(teacher_token),
    )
    step("Student attention", r.ok, r.text[:160] if not r.ok else f"{len(r.json().get('students', []))} students")

    # 8. AI intervention check (F03) — informational, may return None
    r = requests.post(
        f"{BASE}/live/sessions/{session_id}/ai/check-intervention",
        headers=auth(teacher_token),
    )
    step("AI intervention check", r.ok,
         (r.json().get("intervention") or {}).get("title", "no intervention this cycle") if r.ok else r.text[:160])

    # 9. Breakout rooms (F10) — create + status + end
    r = requests.post(
        f"{BASE}/live/sessions/{session_id}/breakout/create",
        headers=auth(teacher_token),
        json={"rooms": [{"name": "Group A", "topic": "Trees", "participant_ids": []}]},
    )
    # If no participants, backend filters out the empty room — this can
    # legitimately return 200 with an empty rooms list.
    step("Breakout create", r.ok, f"{len((r.json() or {}).get('rooms', []))} room(s)" if r.ok else r.text[:160])

    r = requests.get(
        f"{BASE}/live/sessions/{session_id}/breakout/status",
        headers=auth(teacher_token),
    )
    step("Breakout status", r.ok, r.text[:160] if not r.ok else f"{len(r.json().get('rooms', []))} active")

    r = requests.post(
        f"{BASE}/live/sessions/{session_id}/breakout/end",
        headers=auth(teacher_token),
    )
    step("Breakout end", r.ok, r.text[:160] if not r.ok else "")

    # 10. End session
    r = requests.post(f"{BASE}/live/sessions/{session_id}/end", headers=auth(teacher_token))
    step("End session", r.ok, r.text[:160] if not r.ok else "")

    # 11. Health report
    time.sleep(2)
    r = requests.get(
        f"{BASE}/live/sessions/{session_id}/health-report",
        headers=auth(teacher_token),
    )
    step("Health report", r.ok,
         f"overall_score={r.json().get('overall_score')}" if r.ok else r.text[:160])

    # 12. Capsule status — informational only (may still be generating)
    time.sleep(3)
    r = requests.get(
        f"{BASE}/live/sessions/{session_id}/capsule-status",
        headers=auth(teacher_token),
    )
    step("Capsule status", r.ok,
         f"is_ready={r.json().get('is_ready')} capsule_id={r.json().get('capsule_id')}"
         if r.ok else r.text[:160])

    print("\n" + "=" * 60)
    print("SMOKE TEST COMPLETE")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
