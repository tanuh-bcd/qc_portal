-- Add the Mammo Tech role and its Assignment review states.
-- Apply to the QC application database before enabling the Mammo Tech feature.

INSERT INTO qc_bcd_portal.qc_roles (qc_name)
SELECT 'Mammo Tech' WHERE NOT EXISTS (
    SELECT 1 FROM qc_bcd_portal.qc_roles WHERE qc_name = 'Mammo Tech'
);

ALTER TABLE qc_bcd_portal.qc_assignments
    MODIFY COLUMN qc_status ENUM('Pending', 'In-Progress', 'Rejected', 'Completed')
    NOT NULL DEFAULT 'Pending';


ALTER TABLE qc_bcd_portal.qc_assignments
MODIFY qc_status ENUM('Pending','In-Progress','Completed','Rejected') NOT NULL DEFAULT 'Pending';