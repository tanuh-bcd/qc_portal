import sys
import os
from sqlalchemy.orm import Session
from backend.src.db.session import SessionLocal, engine
from backend.src.models import models
from backend.src.core.security import get_password_hash

def seed_data():
    db = SessionLocal()
    try:
        # 1. Create Hospital
        hospital = db.query(models.Hospital).filter(models.Hospital.qc_name == "Test1").first()
        if not hospital:
            hospital = models.Hospital(
                qc_name="Test1",
                qc_contact_person="Ashwin RaajKumar",
                qc_email="ashwin.rajkumar@tanuh.ai",
                qc_address="TANUH Foundation, Indian Institute of Science, Bengaluru"
            )
            db.add(hospital)
            db.commit()
            db.refresh(hospital)
            print(f"Hospital created: {hospital.qc_name}")
        else:
            print("Hospital already exists")

        # 2. Create Roles
        roles = ["Admin", "Doctor", "Staff"]
        for role_name in roles:
            role = db.query(models.Role).filter(models.Role.qc_name == role_name).first()
            if not role:
                role = models.Role(qc_name=role_name)
                db.add(role)
                print(f"Role created: {role_name}")
        db.commit()

        # 3. Create a Test User
        doctor_role = db.query(models.Role).filter(models.Role.qc_name == "Staff").first()
        test_user = db.query(models.User).filter(models.User.qc_email == "breastcancerscreening@tanuh.ai").first()
        if not test_user:
            test_user = models.User(
                qc_email="breastcancerscreening@tanuh.ai",
                qc_password_hash=get_password_hash("BestWishes26"),
                qc_full_name="Test person",
                qc_hospital_id=hospital.qc_id,
                qc_role_id=doctor_role.qc_id,
                qc_is_active=True
            )
            db.add(test_user)
            db.commit()
            print(f"Test user created: {test_user.qc_email}")
        else:
            print("Test user already exists")

    finally:
        db.close()

if __name__ == "__main__":
    seed_data()
