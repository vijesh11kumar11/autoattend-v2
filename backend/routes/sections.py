"""
AutoAttend AI v2.0 — Section Routes

GET    /api/sections                          hod_or_above  — list sections (filter by course_id, semester)
POST   /api/sections                          hod_or_above  — create a section
PUT    /api/sections/{section_id}             hod_or_above  — update a section
DELETE /api/sections/{section_id}             hod_or_above  — delete a section
GET    /api/sections/{section_id}/students    hod_or_above  — list students in a section
POST   /api/sections/assign-students          hod_or_above  — bulk-assign students to a section
POST   /api/sections/assign-students-excel    hod_or_above  — bulk-assign via Excel upload
POST   /api/sections/remove-student           hod_or_above  — remove a student from their section
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import Course, Section, User, UserRole, get_db
from utils.auth_utils import hod_or_above

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sections", tags=["sections"])


# ═══════════════════════════════════════════════════════════════════════
# Pydantic schemas
# ═══════════════════════════════════════════════════════════════════════

class SectionCreate(BaseModel):
    course_id:    int
    semester:     int = Field(..., ge=1, le=10)
    name:         str = Field(..., min_length=1, max_length=10)
    max_strength: Optional[int] = None


class SectionUpdate(BaseModel):
    name:         Optional[str] = Field(None, min_length=1, max_length=10)
    max_strength: Optional[int] = None


class SectionOut(BaseModel):
    id:            int
    department_id: int
    course_id:     int
    course_name:   Optional[str] = None
    semester:      int
    name:          str
    max_strength:  Optional[int] = None
    student_count: int = 0

    class Config:
        from_attributes = True


class StudentBrief(BaseModel):
    id:          int
    name:        str
    roll_number: Optional[str] = None
    email:       str
    semester:    Optional[int] = None

    class Config:
        from_attributes = True


class BulkAssignRequest(BaseModel):
    section_id:  int
    student_ids: List[int]


class RemoveStudentRequest(BaseModel):
    student_id: int


# ═══════════════════════════════════════════════════════════════════════
# GET /api/sections  — list (filterable)
# ═══════════════════════════════════════════════════════════════════════

@router.get("", response_model=List[SectionOut])
def list_sections(
    course_id:    Optional[int] = None,
    semester:     Optional[int] = None,
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    logger.info("📂 SECTIONS LIST │ user_id=%d │ course_id=%s │ semester=%s",
                current_user["id"], course_id, semester)

    q = db.query(Section).filter(
        Section.department_id == current_user["department_id"],
    )
    if course_id is not None:
        q = q.filter(Section.course_id == course_id)
    if semester is not None:
        q = q.filter(Section.semester == semester)

    sections = q.order_by(Section.course_id, Section.semester, Section.name).all()

    result = []
    for s in sections:
        count = (
            db.query(User)
            .filter(User.section_id == s.id, User.role == UserRole.student, User.is_active == True)
            .count()
        )
        course = db.query(Course).filter(Course.id == s.course_id).first()
        result.append(SectionOut(
            id=s.id,
            department_id=s.department_id,
            course_id=s.course_id,
            course_name=course.name if course else None,
            semester=s.semester,
            name=s.name,
            max_strength=s.max_strength,
            student_count=count,
        ))

    logger.info("📂 SECTIONS LIST │ returned %d sections", len(result))
    return result


# ═══════════════════════════════════════════════════════════════════════
# POST /api/sections  — create
# ═══════════════════════════════════════════════════════════════════════

@router.post("", response_model=SectionOut, status_code=status.HTTP_201_CREATED)
def create_section(
    body:         SectionCreate,
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    dept_id = current_user["department_id"]

    # Verify course belongs to the HOD's department
    course = db.query(Course).filter(Course.id == body.course_id).first()
    if not course or course.department_id != dept_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found in your department.")

    # Check duplicate
    existing = (
        db.query(Section)
        .filter(
            Section.course_id == body.course_id,
            Section.semester  == body.semester,
            Section.name      == body.name.strip().upper(),
        )
        .first()
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Section '{body.name.upper()}' already exists for this course & semester.")

    section = Section(
        department_id = dept_id,
        course_id     = body.course_id,
        semester      = body.semester,
        name          = body.name.strip().upper(),
        max_strength  = body.max_strength,
    )
    db.add(section)
    db.commit()
    db.refresh(section)

    logger.info("📂 SECTION CREATED │ id=%d │ course=%s │ sem=%d │ name=%s │ by user_id=%d",
                section.id, course.name, body.semester, section.name, current_user["id"])

    return SectionOut(
        id=section.id,
        department_id=section.department_id,
        course_id=section.course_id,
        course_name=course.name,
        semester=section.semester,
        name=section.name,
        max_strength=section.max_strength,
        student_count=0,
    )


# ═══════════════════════════════════════════════════════════════════════
# PUT /api/sections/{section_id}  — update
# ═══════════════════════════════════════════════════════════════════════

@router.put("/{section_id}", response_model=SectionOut)
def update_section(
    section_id:   int,
    body:         SectionUpdate,
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    section = (
        db.query(Section)
        .filter(Section.id == section_id, Section.department_id == current_user["department_id"])
        .first()
    )
    if not section:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Section not found.")

    if body.name is not None:
        new_name = body.name.strip().upper()
        dup = (
            db.query(Section)
            .filter(
                Section.course_id == section.course_id,
                Section.semester  == section.semester,
                Section.name      == new_name,
                Section.id        != section.id,
            )
            .first()
        )
        if dup:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                f"Section '{new_name}' already exists for this course & semester.")
        section.name = new_name

    if body.max_strength is not None:
        section.max_strength = body.max_strength

    db.commit()
    db.refresh(section)

    count = (
        db.query(User)
        .filter(User.section_id == section.id, User.role == UserRole.student, User.is_active == True)
        .count()
    )
    course = db.query(Course).filter(Course.id == section.course_id).first()

    logger.info("📂 SECTION UPDATED │ id=%d │ name=%s │ by user_id=%d",
                section.id, section.name, current_user["id"])

    return SectionOut(
        id=section.id,
        department_id=section.department_id,
        course_id=section.course_id,
        course_name=course.name if course else None,
        semester=section.semester,
        name=section.name,
        max_strength=section.max_strength,
        student_count=count,
    )


# ═══════════════════════════════════════════════════════════════════════
# DELETE /api/sections/{section_id}
# ═══════════════════════════════════════════════════════════════════════

@router.delete("/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_section(
    section_id:   int,
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    section = (
        db.query(Section)
        .filter(Section.id == section_id, Section.department_id == current_user["department_id"])
        .first()
    )
    if not section:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Section not found.")

    # Unassign students from this section before deleting
    db.query(User).filter(User.section_id == section_id).update({"section_id": None})
    db.delete(section)
    db.commit()

    logger.info("📂 SECTION DELETED │ id=%d │ by user_id=%d", section_id, current_user["id"])


# ═══════════════════════════════════════════════════════════════════════
# GET /api/sections/{section_id}/students
# ═══════════════════════════════════════════════════════════════════════

@router.get("/{section_id}/students", response_model=List[StudentBrief])
def list_section_students(
    section_id:   int,
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    section = (
        db.query(Section)
        .filter(Section.id == section_id, Section.department_id == current_user["department_id"])
        .first()
    )
    if not section:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Section not found.")

    students = (
        db.query(User)
        .filter(
            User.section_id == section_id,
            User.role       == UserRole.student,
            User.is_active  == True,
        )
        .order_by(User.roll_number)
        .all()
    )

    return [
        StudentBrief(
            id=s.id, name=s.name, roll_number=s.roll_number,
            email=s.email, semester=s.semester,
        )
        for s in students
    ]


# ═══════════════════════════════════════════════════════════════════════
# POST /api/sections/assign-students  — bulk assign by IDs
# ═══════════════════════════════════════════════════════════════════════

@router.post("/assign-students")
def bulk_assign_students(
    body:         BulkAssignRequest,
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    section = (
        db.query(Section)
        .filter(Section.id == body.section_id, Section.department_id == current_user["department_id"])
        .first()
    )
    if not section:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Section not found.")

    updated = 0
    not_found = []
    for sid in body.student_ids:
        student = db.query(User).filter(
            User.id   == sid,
            User.role == UserRole.student,
        ).first()
        if not student:
            not_found.append(sid)
            continue
        student.section_id = section.id
        updated += 1

    db.commit()

    logger.info("📂 BULK ASSIGN │ section_id=%d │ assigned=%d │ not_found=%d │ by user_id=%d",
                section.id, updated, len(not_found), current_user["id"])

    return {
        "assigned": updated,
        "not_found": not_found,
        "section_id": section.id,
        "section_name": section.name,
    }


# ═══════════════════════════════════════════════════════════════════════
# POST /api/sections/assign-students-excel  — bulk assign via Excel
# ═══════════════════════════════════════════════════════════════════════

@router.post("/assign-students-excel")
def bulk_assign_excel(
    section_id:   int,
    file:         UploadFile = File(...),
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    """
    Expects an Excel (.xlsx) file with a column named 'roll_number'.
    Each matching student gets assigned to the given section.
    """
    section = (
        db.query(Section)
        .filter(Section.id == section_id, Section.department_id == current_user["department_id"])
        .first()
    )
    if not section:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Section not found.")

    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please upload an Excel file (.xlsx).")

    import openpyxl

    try:
        wb = openpyxl.load_workbook(file.file, read_only=True, data_only=True)
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Excel file.")

    ws = wb.active
    if ws is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Excel file has no active sheet.")

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Excel file is empty.")

    # Find the 'roll_number' column
    header = [str(c).strip().lower() if c else "" for c in rows[0]]
    try:
        rn_idx = header.index("roll_number")
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Excel must have a 'roll_number' column header.")

    assigned = 0
    not_found_rolls = []

    for row in rows[1:]:
        if rn_idx >= len(row) or not row[rn_idx]:
            continue
        roll = str(row[rn_idx]).strip()
        student = db.query(User).filter(
            User.roll_number == roll,
            User.role        == UserRole.student,
        ).first()
        if not student:
            not_found_rolls.append(roll)
            continue
        student.section_id = section.id
        assigned += 1

    db.commit()
    wb.close()

    logger.info("📂 EXCEL ASSIGN │ section_id=%d │ assigned=%d │ not_found=%d │ by user_id=%d",
                section.id, assigned, len(not_found_rolls), current_user["id"])

    return {
        "assigned": assigned,
        "not_found_rolls": not_found_rolls,
        "section_id": section.id,
        "section_name": section.name,
    }


# ═══════════════════════════════════════════════════════════════════════
# POST /api/sections/remove-student  — remove student from section
# ═══════════════════════════════════════════════════════════════════════

@router.post("/remove-student")
def remove_student_from_section(
    body:         RemoveStudentRequest,
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    student = db.query(User).filter(
        User.id   == body.student_id,
        User.role == UserRole.student,
    ).first()
    if not student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")

    old_section_id = student.section_id
    student.section_id = None
    db.commit()

    logger.info("📂 REMOVE FROM SECTION │ student_id=%d │ old_section_id=%s │ by user_id=%d",
                body.student_id, old_section_id, current_user["id"])

    return {"removed": True, "student_id": body.student_id}
