
### Recommended Multi-Language Schema

We will introduce a `languages` table and two translation tables: `question_translations` and `question_option_translations`.

#### 1. `languages` Table
Stores the supported languages in the system.

| Column | Type | Description |
| :--- | :--- | :--- |
| `code` | `VARCHAR(5) (PK)` | ISO language code (e.g., 'en', 'hi', 'or'). |
| `name` | `VARCHAR(50)` | Full name of the language (e.g., 'English', 'Hindi'). |

#### 2. `questions` (Updated)
The main table now only contains structural and logic data, removing the `question_text`.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `INT (PK)` | Unique identifier. |
| `section` | `VARCHAR` | Category/Module. |
| `response_type` | `ENUM` | `text`, `option`, etc. |
| `parent_question_id`| `INT` | For conditional logic. |

#### 3. `question_translations` (New)
Stores the actual question text for each language.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `INT (PK)` | Unique identifier. |
| `question_id` | `INT (FK)` | Link to `questions`. |
| `language_code` | `VARCHAR (FK)`| Link to `languages`. |
| `question_text` | `TEXT` | The translated question. |

#### 4. `question_option_translations` (New)
Stores the labels for options in different languages.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `INT (PK)` | Unique identifier. |
| `option_id` | `INT (FK)` | Link to `question_options`. |
| `language_code` | `VARCHAR (FK)`| Link to `languages`. |
| `option_label` | `VARCHAR` | The translated option text. |

---

### SQL Implementation Example

```sql
-- 1. Languages Table
CREATE TABLE languages (
    code VARCHAR(5) PRIMARY KEY, -- e.g., 'en', 'hi', 'or'
    name VARCHAR(50) NOT NULL
);

-- 2. Base Questions Table (No text here)
CREATE TABLE questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    section VARCHAR(100),
    response_type ENUM('text_field', 'option', 'numbers_only') NOT NULL,
    parent_question_id INT DEFAULT NULL,
    trigger_answer VARCHAR(255) DEFAULT NULL,
    FOREIGN KEY (parent_question_id) REFERENCES questions(id)
);

-- 3. Question Translations
CREATE TABLE question_translations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question_id INT NOT NULL,
    language_code VARCHAR(5) NOT NULL,
    question_text TEXT NOT NULL,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    FOREIGN KEY (language_code) REFERENCES languages(code),
    UNIQUE(question_id, language_code) -- Ensures one translation per language
);

-- 4. Question Options (Base)
CREATE TABLE question_options (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question_id INT NOT NULL,
    option_value VARCHAR(255) NOT NULL, -- Internal value (e.g. 'yes')
    sort_order INT DEFAULT 0,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- 5. Option Translations
CREATE TABLE question_option_translations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    option_id INT NOT NULL,
    language_code VARCHAR(5) NOT NULL,
    option_label VARCHAR(255) NOT NULL, -- Display label (e.g. 'Yes', 'हाँ')
    FOREIGN KEY (option_id) REFERENCES question_options(id) ON DELETE CASCADE,
    FOREIGN KEY (language_code) REFERENCES languages(code),
    UNIQUE(option_id, language_code)
);
```

### Benefits of this Approach

1.  **Unlimited Languages**: You can add a new language simply by adding a row to `languages` and providing translations, without changing the database schema.
2.  **Clean Logic**: Your application logic (e.g., "if answer is 'yes', show Q2") stays the same regardless of the user's display language because it relies on the `option_value` (e.g., 'yes') rather than the translated `option_label` (e.g., 'Odia Yes').
3.  **Fallback Mechanism**: In your backend code, you can easily implement a fallback (e.g., if a translation in 'Odia' isn't found, default to 'English').
4.  **Performance**: Querying is efficient. To get a questionnaire in Hindi, you just `JOIN` with the translation tables where `language_code = 'hi'`.