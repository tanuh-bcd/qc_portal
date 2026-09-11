ALTER TABLE qc_bcd_portal.qc_assignments
    ADD CONSTRAINT uq_assignment_assessment_role UNIQUE (qc_assessment_id, qc_role_id);

ALTER TABLE qc_bcd_portal.qc_assignments
    DROP INDEX uq_assignment_assessment;
