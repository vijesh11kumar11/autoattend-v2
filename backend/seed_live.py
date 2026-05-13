"""
seed_live.py — Demo data for ClassPulse Live (PROMPT 8).
Run from backend/:
    python seed_live.py

Creates:
  • 3 LiveSession rows (standalone, capsule_locked, public)
  • 10 LiveSessionParticipant rows (mix of present/absent)
  • 1 PulseCheck attached to the standalone session
  • StudentKnowledgeGraph entries for 3 students × 4 topics

Idempotent: clears prior demo rows (by join_link prefix) before inserting.
"""
from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta, timezone

from database import (
    Capsule,
    Course,
    KnowledgeLevel,
    LiveParticipantType,
    LiveSession,
    LiveSessionParticipant,
    LiveSessionStatus,
    LiveSessionType,
    PulseCheck,
    PulseCheckAnswer,
    PulseCheckTrigger,
    Section,
    SessionLocal,
    StudentKnowledgeGraph,
    Subject,
    User,
    UserRole,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s ▸ %(message)s")
log = logging.getLogger("seed_live")

DEMO_LINKS = ["DEM-ODS-001", "CAP-SBT-001", "OPE-NDS-001"]


def main() -> None:
    db = SessionLocal()
    try:
        # ── Pick a teacher + subject + students from existing data ────
        teacher = (
            db.query(User)
            .filter(User.role == UserRole.teacher, User.is_active.is_(True))
            .first()
        )
        if not teacher:
            log.error("No teacher found. Run seed.py first.")
            return
        subject = db.query(Subject).filter(Subject.teacher_id == teacher.id).first()
        if not subject:
            log.error("Teacher has no subject. Run seed.py first.")
            return

        # Pick a section in same department as the subject's course
        course = db.query(Course).filter(Course.id == subject.course_id).first()
        section = (
            db.query(Section)
            .filter(Section.department_id == (course.department_id if course else None))
            .first()
        )
        section_id = section.id if section else None

        students = (
            db.query(User)
            .filter(
                User.role == UserRole.student,
                User.is_active.is_(True),
            )
            .filter(User.section_id == section_id) if section_id else db.query(User).filter(
                User.role == UserRole.student, User.is_active.is_(True)
            )
        )
        students = students.limit(10).all()
        if len(students) < 3:
            log.error("Need at least 3 students. Run seed.py first.")
            return

        # ── Wipe existing demo rows ───────────────────────────────────
        db.query(LiveSession).filter(LiveSession.join_link.in_(DEMO_LINKS)).delete(
            synchronize_session=False
        )
        db.commit()

        now = datetime.now(timezone.utc)

        # ── 1. Standalone session (ended, with health report) ─────────
        s1 = LiveSession(
            session_type=LiveSessionType.standalone,
            title="Demo: Decision Trees Walkthrough",
            teacher_id=teacher.id,
            subject_id=subject.id,
            section_id=section_id,
            status=LiveSessionStatus.ended,
            join_link=DEMO_LINKS[0],
            allow_guests=False,
            recording_enabled=True,
            session_health_score=78,
            health_report_json={
                "overall_health": 78,
                "engagement": 82,
                "comprehension": 74,
                "concerns": ["Pacing dropped at 18:00"],
                "highlights": ["Strong Q&A engagement"],
            },
            started_at=now - timedelta(hours=3),
            ended_at=now - timedelta(hours=2, minutes=10),
            duration_minutes=50,
        )
        db.add(s1)

        # ── 2. Capsule-locked session (waiting) ───────────────────────
        cap = db.query(Capsule).filter(Capsule.teacher_id == teacher.id).first()
        s2 = LiveSession(
            session_type=LiveSessionType.capsule_locked,
            title="Demo: Backtracking Live (capsule-locked)",
            teacher_id=teacher.id,
            subject_id=subject.id,
            section_id=section_id,
            capsule_id=cap.id if cap else None,
            status=LiveSessionStatus.waiting,
            join_link=DEMO_LINKS[1],
            allow_guests=False,
            recording_enabled=True,
        )
        db.add(s2)

        # ── 3. Public session (waiting, password) ─────────────────────
        s3 = LiveSession(
            session_type=LiveSessionType.public,
            title="Demo: Open Lecture — Data Structures (DS2026)",
            teacher_id=teacher.id,
            subject_id=subject.id,
            section_id=section_id,
            status=LiveSessionStatus.waiting,
            join_link=DEMO_LINKS[2],
            join_password="DS2026",
            allow_guests=True,
            allow_guest_interaction=True,
            recording_enabled=True,
            max_guests=200,
        )
        db.add(s3)
        db.flush()

        # ── Participants for s1 (10 students, 7 present) ──────────────
        for i, stu in enumerate(students[:10]):
            is_present = i < 7
            db.add(
                LiveSessionParticipant(
                    live_session_id=s1.id,
                    user_id=stu.id,
                    participant_type=LiveParticipantType.student,
                    joined_at=now - timedelta(hours=3),
                    left_at=now - timedelta(hours=2, minutes=10) if is_present else now - timedelta(hours=2, minutes=55),
                    total_duration_seconds=2700 if is_present else 200,
                    is_attendance_counted=is_present,
                    is_active=False,
                    liveness_check_passed=is_present,
                )
            )

        # ── PulseCheck for s1 ─────────────────────────────────────────
        db.add(
            PulseCheck(
                live_session_id=s1.id,
                question_text="Which split criterion is used by ID3?",
                option_a="Gini impurity",
                option_b="Information gain",
                option_c="Variance reduction",
                option_d="Chi-square",
                correct_answer=PulseCheckAnswer.B,
                explanation="ID3 uses information gain based on entropy.",
                triggered_by=PulseCheckTrigger.teacher,
                triggered_at=now - timedelta(hours=2, minutes=40),
                duration_seconds=30,
                closed_at=now - timedelta(hours=2, minutes=39, seconds=30),
                total_responses=7,
                correct_responses=5,
                response_distribution={"a": 1, "b": 5, "c": 1, "d": 0},
            )
        )

        # ── Knowledge graph entries: 3 students × 4 topics ────────────
        topics = [
            ("Entropy", KnowledgeLevel.strong),
            ("Information Gain", KnowledgeLevel.moderate),
            ("Pruning", KnowledgeLevel.weak),
            ("Random Forest", KnowledgeLevel.not_covered),
        ]
        for stu in students[:3]:
            for topic, level in topics:
                # Skip if already present
                exists = (
                    db.query(StudentKnowledgeGraph)
                    .filter(
                        StudentKnowledgeGraph.student_id == stu.id,
                        StudentKnowledgeGraph.subject_id == subject.id,
                        StudentKnowledgeGraph.topic_name == topic,
                    )
                    .first()
                )
                if exists:
                    continue
                db.add(
                    StudentKnowledgeGraph(
                        student_id=stu.id,
                        subject_id=subject.id,
                        topic_name=topic,
                        understanding_level=level,
                        confidence_score=random.uniform(0.3, 0.9),
                        last_assessed_session_id=s1.id,
                        times_confused=2 if level == KnowledgeLevel.weak else 0,
                        times_understood=3 if level == KnowledgeLevel.strong else 1,
                    )
                )

        db.commit()
        log.info("✅ Live-session demo data inserted")
        log.info("    Standalone   → join code %s", DEMO_LINKS[0])
        log.info("    Capsule-lock → join code %s", DEMO_LINKS[1])
        log.info("    Public       → join code %s (password: DS2026)", DEMO_LINKS[2])
    except Exception:
        db.rollback()
        log.exception("seed_live failed")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
