### Database Design for Patient Question and Answer Sessions

#### 1. SQL Table Design: `patient_responses`

This table will store the actual answers provided by patients during their hospital sessions.

```sql
CREATE TABLE `patient_responses` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `hospital_id` INT NOT NULL,
    `session_id` INT NOT NULL,
    `question` TEXT NOT NULL,
    `answer` TEXT NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign Key Constraints to maintain data integrity
    FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`),
    FOREIGN KEY (`session_id`) REFERENCES `patient_sessions`(`id`) ON DELETE CASCADE,
    
    -- Performance Optimization
    INDEX (`session_id`),
    INDEX (`hospital_id`)
);
```

#### 2. Improvements and Design Rationale

*   **Normalization (Use `question_id`):** Instead of saving the raw question text, we reference the `questions(id)`. This ensures that if a question's text is updated (or translated), the historical record remains linked to the correct logical question.
*   **Audit Trails:** Added `updated_at` with `ON UPDATE CURRENT_TIMESTAMP` to track when a response was modified after initial entry.
*   **Cascading Deletes:** The `ON DELETE CASCADE` on `session_id` ensures that if a patient session is deleted (e.g., due to data privacy requests), all associated answers are automatically cleaned up.
*   **Indexing:** Added indexes on `session_id` and `hospital_id` to ensure fast retrieval when generating reports for a specific patient or hospital.

#### 3. Integration with Your Current Project (SQLAlchemy)

If you are using the existing backend structure, you should add this model to `backend/src/models/models.py`:

```python
class PatientResponse(Base):
    __tablename__ = "patient_responses"

    id = Column(Integer, primary_key=True, index=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), nullable=False)
    session_id = Column(Integer, ForeignKey("patient_sessions.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    answer = Column(Text, nullable=False)
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"))

    # Relationships
    hospital = relationship("Hospital")
    session = relationship("PatientSession", back_populates="responses")
    question = relationship("Question")

# Note: Update PatientSession to include the relationship
# PatientSession.responses = relationship("PatientResponse", back_populates="session")
```

#### 4. Handling Multi-Language Answers

Since your project already supports multiple languages (Hindi, Odia, etc.), consider the following during implementation:
*   **For Options:** Save the `option_value` (e.g., "yes") rather than the translated label. This makes data analysis easier.
*   **For Text:** Save the raw text entered by the patient. If you need to know which language they were using during the session, you might consider adding a `language_code` column to the `patient_sessions` table.