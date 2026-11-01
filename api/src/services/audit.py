import json
from sqlalchemy.ext.asyncio import AsyncSession
import ulid

from ..models.db import AuditEvent


async def log_audit_event(
    db: AsyncSession,
    action: str,
    target_type: str,
    actor_id: str | None = None,
    target_id: str | None = None,
    details: dict | None = None,
) -> AuditEvent:
    """Record an audit event in the database."""
    event = AuditEvent(
        id=str(ulid.new()),
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=json.dumps(details) if details else None,
    )
    db.add(event)
    return event
