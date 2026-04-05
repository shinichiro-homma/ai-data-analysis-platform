"""Bearer token authentication dependency for document-server."""

from __future__ import annotations

import secrets

from fastapi import Header, HTTPException

from .config import DOCUMENT_SERVER_TOKEN

_WWW_AUTHENTICATE = {"WWW-Authenticate": "Bearer"}


async def verify_token(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency that verifies the Bearer token in the Authorization header.

    Raises HTTP 401 if the token is missing, malformed, or incorrect.
    Uses secrets.compare_digest to prevent timing attacks.
    Conforms to RFC 6750 (WWW-Authenticate header) and RFC 7235 (case-insensitive scheme).
    """
    if authorization is None:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization header",
            headers=_WWW_AUTHENTICATE,
        )

    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Invalid Authorization header format. Expected: Bearer <token>",
            headers=_WWW_AUTHENTICATE,
        )

    token = parts[1]
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Bearer token must not be empty",
            headers=_WWW_AUTHENTICATE,
        )

    try:
        token_bytes = token.encode("ascii")
        expected_bytes = DOCUMENT_SERVER_TOKEN.encode("ascii")
    except UnicodeEncodeError:
        raise HTTPException(
            status_code=401,
            detail="Invalid token",
            headers=_WWW_AUTHENTICATE,
        ) from None

    if not secrets.compare_digest(token_bytes, expected_bytes):
        raise HTTPException(
            status_code=401,
            detail="Invalid token",
            headers=_WWW_AUTHENTICATE,
        )
