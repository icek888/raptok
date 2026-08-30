"""
Admin router — user management, quotas, global stats.
All endpoints require admin role.
"""
import logging
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from services import database
from routers.auth import SESSION_COOKIE, _verify_token

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_user(request: Request) -> dict:
    """Extract full user info from session."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Not authenticated")
    session = _verify_token(token)
    if not session:
        raise HTTPException(401, "Session expired")
    user = database.get_user(session["username"])
    if not user or not user["is_active"]:
        raise HTTPException(401, "Account disabled")
    return user


def _require_admin(request: Request) -> dict:
    """Require admin role."""
    user = _get_user(request)
    if user["role"] != "admin":
        raise HTTPException(403, "Admin access required")
    return user


# ── Admin Stats ──

@router.get("/api/admin/stats")
async def admin_stats(request: Request):
    _require_admin(request)
    return database.get_admin_stats()


# ── User Management ──

@router.get("/api/admin/users")
async def list_users(request: Request):
    _require_admin(request)
    return {"users": database.list_all_users()}


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "user"
    plan: str = "free"


@router.post("/api/admin/users")
async def create_user(request: Request, data: CreateUserRequest):
    _require_admin(request)
    if data.role == "admin":
        raise HTTPException(400, "Cannot create admin users via API")
    user = database.create_user_db(data.username, data.password, data.role, data.plan)
    if not user:
        raise HTTPException(409, "Username already exists")
    logger.info(f"Admin created user: {data.username} (plan={data.plan})")
    return {"username": user["username"], "role": user["role"], "plan": user["plan"]}


class UpdateUserRequest(BaseModel):
    password: str | None = None
    role: str | None = None
    plan: str | None = None
    is_active: int | None = None


@router.put("/api/admin/users/{username}")
async def update_user(request: Request, username: str, data: UpdateUserRequest):
    admin = _require_admin(request)
    # Prevent self-deactivation
    if username == admin["username"] and data.is_active == 0:
        raise HTTPException(400, "Cannot deactivate your own account")
    result = database.update_user(username, data.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(404, "User not found")
    logger.info(f"Admin {admin['username']} updated user: {username} -> {data.model_dump(exclude_none=True)}")
    return {"username": result["username"], "role": result["role"], "plan": result["plan"], "is_active": result["is_active"]}


@router.delete("/api/admin/users/{username}")
async def delete_user(request: Request, username: str):
    admin = _require_admin(request)
    if username == admin["username"]:
        raise HTTPException(400, "Cannot delete your own account")
    if not database.delete_user(username):
        raise HTTPException(404, "User not found or cannot delete admin")
    logger.info(f"Admin {admin['username']} deleted user: {username}")
    return {"status": "deleted"}


# ── Quota Management ──

@router.get("/api/admin/users/{username}/quota")
async def user_quota(request: Request, username: str):
    _require_admin(request)
    return database.get_quota_stats(username)


@router.get("/api/quota")
async def my_quota(request: Request):
    """Get current user's quota info."""
    user = _get_user(request)
    return database.get_quota_stats(user["username"])


# ── Plans ──

@router.get("/api/plans")
async def get_plans():
    """Get all available plans and their limits (public)."""
    return database.PLAN_LIMITS