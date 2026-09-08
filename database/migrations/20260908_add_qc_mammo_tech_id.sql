
ALTER TABLE qc_bcd_portal.qc_assignments
    ADD COLUMN qc_mammo_tech_id INT NULL AFTER qc_radiologist_id;

ALTER TABLE qc_bcd_portal.qc_assignments
    ADD CONSTRAINT qc_assignments_ibfk_mammo_tech
    FOREIGN KEY (qc_mammo_tech_id) REFERENCES qc_bcd_portal.qc_users (qc_id);
