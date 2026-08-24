from backend.src.core import email as email_service
from backend.src.models.models import EmailTemplate, EmailTemplateCc
from backend.tests.conftest import TestSession


def test_explicit_cc_is_deduplicated_and_kept_separate_from_db_cc(monkeypatch):
    db = TestSession()
    template_key = "explicit_cc_test"
    captured = {}

    def fake_send_email(to_email, subject, html, **kwargs):
        captured.update({
            "to": to_email,
            "subject": subject,
            "html": html,
            **kwargs,
        })
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    try:
        db.add(EmailTemplate(
            qc_template_key=template_key,
            qc_subject="Hello {{name}}",
            qc_body_html="<p>Hello {{name}}</p>",
        ))
        db.flush()
        db.add(EmailTemplateCc(
            qc_template_key=template_key,
            qc_cc_email="existing@example.com",
        ))
        db.commit()

        sent = email_service.send_template_email(
            db,
            template_key,
            "recipient@example.com",
            {"name": "Recipient"},
            cc=[
                "bcs@tanuh.ai",
                "BCS@TANUH.AI",
                "recipient@example.com",
            ],
            include_configured_cc=True,
        )

        assert sent is True
        assert captured["to"] == "recipient@example.com"
        assert captured["cc"] == ["bcs@tanuh.ai", "existing@example.com"]
    finally:
        db.query(EmailTemplateCc).filter(
            EmailTemplateCc.qc_template_key == template_key,
        ).delete(synchronize_session=False)
        db.query(EmailTemplate).filter(
            EmailTemplate.qc_template_key == template_key,
        ).delete(synchronize_session=False)
        db.commit()
        db.close()
