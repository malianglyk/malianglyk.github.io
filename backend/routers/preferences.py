"""Preferences router — user constraints, feature weights, model training, stats.

Endpoints:
  GET    /api/preferences/constraints    get user's time constraints
  PUT    /api/preferences/constraints    update time constraints
  GET    /api/preferences/weights        get current feature weights
  POST   /api/preferences/train          force retrain model
  GET    /api/preferences/stats          model metadata
"""
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import (
    User, UserConstraints, UserPreferences, PairwiseComparison,
    ConstraintsIn, ConstraintsOut, WeightsOut, TrainStatsOut,
)
from auth import get_current_user
from ml_engine import (
    FEATURE_LABELS, N_FEATURES,
    parse_time_str, fmt_time, fmt_time_24h,
    get_default_weights, train_weights,
)

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


# ---------------------------------------------------------------------------
#  Constraints
# ---------------------------------------------------------------------------

def _get_constraints(db: Session, user_id: int) -> UserConstraints:
    """Get or create constraints row for a user."""
    c = db.query(UserConstraints).filter(UserConstraints.user_id == user_id).first()
    if not c:
        c = UserConstraints(user_id=user_id)
        db.add(c)
        db.commit()
        db.refresh(c)
    return c


@router.get("/constraints", response_model=ConstraintsOut)
def get_constraints(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    c = _get_constraints(db, user.id)
    return ConstraintsOut(
        wake_up_time=fmt_time_24h(c.wake_up_time),
        sleep_time=fmt_time_24h(c.sleep_time),
        school_start=fmt_time_24h(c.school_start),
        school_end=fmt_time_24h(c.school_end),
        break_duration=c.break_duration,
        lunch_duration=c.lunch_duration,
        dinner_duration=c.dinner_duration,
        lunch_start=fmt_time_24h(c.lunch_start),
        dinner_start=fmt_time_24h(c.dinner_start),
    )


@router.put("/constraints", response_model=ConstraintsOut)
def update_constraints(
    body: ConstraintsIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    c = _get_constraints(db, user.id)
    c.wake_up_time = parse_time_str(body.wake_up_time)
    c.sleep_time = parse_time_str(body.sleep_time)
    c.school_start = parse_time_str(body.school_start)
    c.school_end = parse_time_str(body.school_end)
    c.break_duration = body.break_duration
    c.lunch_duration = body.lunch_duration
    c.dinner_duration = body.dinner_duration
    c.lunch_start = parse_time_str(body.lunch_start)
    c.dinner_start = parse_time_str(body.dinner_start)
    db.commit()
    db.refresh(c)

    return ConstraintsOut(
        wake_up_time=fmt_time_24h(c.wake_up_time),
        sleep_time=fmt_time_24h(c.sleep_time),
        school_start=fmt_time_24h(c.school_start),
        school_end=fmt_time_24h(c.school_end),
        break_duration=c.break_duration,
        lunch_duration=c.lunch_duration,
        dinner_duration=c.dinner_duration,
        lunch_start=fmt_time_24h(c.lunch_start),
        dinner_start=fmt_time_24h(c.dinner_start),
    )


# ---------------------------------------------------------------------------
#  Weights
# ---------------------------------------------------------------------------

def _get_preferences(db: Session, user_id: int) -> UserPreferences:
    """Get or create preferences row for a user."""
    p = db.query(UserPreferences).filter(UserPreferences.user_id == user_id).first()
    if not p:
        p = UserPreferences(user_id=user_id)
        db.add(p)
        db.commit()
        db.refresh(p)
    return p


@router.get("/weights", response_model=WeightsOut)
def get_weights(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    pref = _get_preferences(db, user.id)
    num_pairs = (
        db.query(PairwiseComparison)
        .filter(PairwiseComparison.user_id == user.id)
        .count()
    )

    is_default = False
    try:
        stored = json.loads(pref.weights_json) if pref.weights_json else {}
    except json.JSONDecodeError:
        stored = {}

    if not stored or len(stored) != N_FEATURES or num_pairs < 5:
        # Return default weights
        default_w = get_default_weights()
        weights_dict = {FEATURE_LABELS[i]: default_w[i] for i in range(N_FEATURES)}
        is_default = True
    else:
        weights_dict = {FEATURE_LABELS[i]: stored.get(str(i), 0.0) for i in range(N_FEATURES)}

    return WeightsOut(
        weights=weights_dict,
        num_comparisons=num_pairs,
        last_trained_at=pref.last_trained_at,
        training_loss=pref.training_loss,
        is_default=is_default,
    )


# ---------------------------------------------------------------------------
#  Train
# ---------------------------------------------------------------------------

@router.post("/train", response_model=TrainStatsOut)
def train_model(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    weights, loss = train_weights(user.id, db)

    if weights is None:
        # Not enough data — return default weights
        weights = get_default_weights()
        loss = 0.0

    num_pairs = (
        db.query(PairwiseComparison)
        .filter(PairwiseComparison.user_id == user.id)
        .count()
    )

    # Persist weights
    pref = _get_preferences(db, user.id)
    weights_json = json.dumps({str(i): round(w, 6) for i, w in enumerate(weights)})
    pref.weights_json = weights_json
    pref.num_comparisons = num_pairs
    pref.last_trained_at = datetime.now()
    pref.training_loss = loss
    db.commit()

    # Build labelled weight dict
    weights_dict = {FEATURE_LABELS[i]: round(weights[i], 6) for i in range(N_FEATURES)}

    # Top 5 features by absolute weight magnitude
    ranked = sorted(
        weights_dict.items(),
        key=lambda kv: abs(kv[1]),
        reverse=True,
    )
    top5 = ranked[:5]

    return TrainStatsOut(
        weights=weights_dict,
        num_comparisons=num_pairs,
        num_pairs_used=num_pairs,
        training_loss=loss,
        top_features=[(label, val) for label, val in top5],
        last_trained_at=pref.last_trained_at,
    )


# ---------------------------------------------------------------------------
#  Stats
# ---------------------------------------------------------------------------

@router.get("/stats", response_model=TrainStatsOut)
def get_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    pref = _get_preferences(db, user.id)
    num_pairs = (
        db.query(PairwiseComparison)
        .filter(PairwiseComparison.user_id == user.id)
        .count()
    )

    is_default = False
    try:
        stored = json.loads(pref.weights_json) if pref.weights_json else {}
    except json.JSONDecodeError:
        stored = {}

    if not stored or len(stored) != N_FEATURES or num_pairs < 5:
        weights = get_default_weights()
        is_default = True
    else:
        weights = [stored.get(str(i), 0.0) for i in range(N_FEATURES)]

    weights_dict = {FEATURE_LABELS[i]: round(weights[i], 6) for i in range(N_FEATURES)}

    ranked = sorted(weights_dict.items(), key=lambda kv: abs(kv[1]), reverse=True)
    top5 = ranked[:5]

    return TrainStatsOut(
        weights=weights_dict,
        num_comparisons=num_pairs,
        num_pairs_used=0 if is_default else num_pairs,
        training_loss=pref.training_loss,
        top_features=[(label, val) for label, val in top5],
        last_trained_at=pref.last_trained_at,
    )
