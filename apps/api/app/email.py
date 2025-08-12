from email.message import EmailMessage
import smtplib
from typing import Iterable, Optional
from fastapi import BackgroundTasks

from . import config

def _build_message(subject: str, html: str, to: Iterable[str], cc: Optional[Iterable[str]] = None, bcc: Optional[Iterable[str]] = None) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = config.SMTP_FROM
    to_list = list(dict.fromkeys([e.strip() for e in to if e and e.strip()]))
    if not to_list:
        raise ValueError("At least one recipient required")
    msg["To"] = ", ".join(to_list)
    if cc:
        cc_list = list(dict.fromkeys([e.strip() for e in cc if e and e.strip()]))
        if cc_list:
            msg["Cc"] = ", ".join(cc_list)
    msg.set_content("HTML email. Please view as HTML.")
    msg.add_alternative(html, subtype="html")
    return msg

def _send_now(msg: EmailMessage) -> None:
    if not config.EMAIL_ENABLED:
        return  # no-op in dev unless enabled
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as server:
        if config.SMTP_STARTTLS:
            server.starttls()
        if config.SMTP_USER and config.SMTP_PASSWORD:
            server.login(config.SMTP_USER, config.SMTP_PASSWORD)
        all_rcpts = []
        for h in ["To", "Cc", "Bcc"]:
            if msg.get(h):
                all_rcpts.extend([e.strip() for e in msg.get(h).split(",") if e.strip()])
        server.send_message(msg, to_addrs=list(dict.fromkeys(all_rcpts)))

def send_email(background: BackgroundTasks, subject: str, html: str, to: Iterable[str], cc: Optional[Iterable[str]] = None, bcc: Optional[Iterable[str]] = None) -> None:
    msg = _build_message(subject, html, to, cc, bcc)
    background.add_task(_send_now, msg)
