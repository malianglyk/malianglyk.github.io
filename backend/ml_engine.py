"""
ML Engine for Student Planner — Pure Python (zero dependencies).

Provides:
  1. Feature vector encoding for tasks    →  encode_task(task) -> list[float]
  2. Pairwise logistic regression training →  train_weights(user_id, db) -> (list[float], float)
  3. Scoring / ranking                     →  score_task(task, weights) -> float
  4. Cold-start default weights            →  get_default_weights() -> list[float]

Design: linear model  score = w · x
Learned via gradient descent on pairwise differences (Bradley-Terry / RankSVM).
"""
import math
import json
from datetime import date, datetime
from typing import Optional


# ---------------------------------------------------------------------------
#  Feature encoding
# ---------------------------------------------------------------------------

# Order must match the weight vector positions (indices 0–7)
SUBJECTS = ["Math", "Science", "History", "English", "CS", "Language", "Art", "Other"]

# Label each feature dimension for interpretability
FEATURE_LABELS = (
    [f"subject_{s}" for s in SUBJECTS]   # 0-7
    + ["is_paper_based"]                  # 8
    + ["estimated_time_norm"]             # 9
    + ["deadline_urgency"]                # 10
    + ["difficulty_norm"]                 # 11
    + ["bias"]                            # 12
)

N_FEATURES = len(FEATURE_LABELS)  # 13


def encode_task(task) -> list[float]:
    """Convert a Task ORM object into a 13-dimensional feature vector.

    Features (in order):
      [0-7]   subject one-hot    (8 dims)
      [8]     is_paper_based     (0 or 1)
      [9]     estimated_time_norm(duration / 480)
      [10]    deadline_urgency   (1 / (1 + days_until_deadline))
      [11]    difficulty_norm    ((difficulty - 1) / 4)
      [12]    bias               (always 1.0 — allows learned intercept)
    """
    vec: list[float] = []

    # 1) Subject one-hot (8 features)
    for subj in SUBJECTS:
        vec.append(1.0 if task.category == subj else 0.0)

    # 2) Is paper-based (1 feature)
    vec.append(1.0 if task.is_paper_based else 0.0)

    # 3) Estimated time normalised (1 feature)
    vec.append(task.duration / 480.0)

    # 4) Deadline urgency — nonlinear proximity (1 feature)
    # Now supports "YYYY-MM-DD HH:MM" format for hour precision
    if task.deadline:
        try:
            from datetime import datetime as dt, timezone
            dl = task.deadline.strip()
            # Try datetime with hour:minute first
            if " " in dl and len(dl) >= 16:
                deadline_dt = dt.strptime(dl[:16], "%Y-%m-%d %H:%M")
            elif "T" in dl:
                deadline_dt = dt.fromisoformat(dl.replace("Z", "+00:00"))
            else:
                # Date only → assume end of that day
                deadline_dt = dt.strptime(dl[:10], "%Y-%m-%d").replace(hour=23, minute=59)
            now = dt.now(timezone.utc).replace(tzinfo=None)
            hours_remaining = (deadline_dt - now).total_seconds() / 3600.0
            urgency = 1.0 / (1.0 + max(hours_remaining / 24.0, 0))  # normalize to days scale
        except (ValueError, TypeError):
            urgency = 0.1  # malformed date → low urgency
    else:
        urgency = 0.0  # no deadline → no urgency pressure
    vec.append(urgency)

    # 5) Difficulty normalised (1 feature)
    vec.append((task.difficulty - 1) / 4.0)

    # 6) Bias term (always 1.0)
    vec.append(1.0)

    return vec


# ---------------------------------------------------------------------------
#  Scoring
# ---------------------------------------------------------------------------

def compute_score(features: list[float], weights: list[float]) -> float:
    """Dot product: weighted sum of features → scalar score."""
    return sum(w * x for w, x in zip(weights, features))


def score_tasks(tasks, weights: list[float], constraints=None) -> list[tuple]:
    """Score and sort tasks descending by ML score + priority offset.

    Returns list of (task, score) sorted highest-first.
    """
    scored = []
    for task in tasks:
        features = encode_task(task)
        score = compute_score(features, weights)

        # Priority modifier (non-learned base offset)
        if task.priority == "high":
            score += 0.5
        elif task.priority == "medium":
            score += 0.0
        elif task.priority == "low":
            score -= 0.3

        scored.append((task, round(score, 4)))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored


# ---------------------------------------------------------------------------
#  Cold-start / default weights
# ---------------------------------------------------------------------------

def get_default_weights() -> list[float]:
    """Heuristic default weights for users with too few pairwise comparisons.

    Design philosophy (based on common student behaviour):
      - Harder tasks get placed earlier in the day (morning energy peak).
      - Imminent deadlines get strong priority.
      - Paper-based tasks get a slight afternoon preference.
      - CS / Math / Science get slight morning preference.
      - Art / English / History get slight afternoon preference.
      - Positive bias means "prefer earlier in the day by default."
    """
    # Subject: morning-heavy subjects positive, afternoon-heavy negative
    w_subject = [
        0.15,   # Math     — morning preference
        0.15,   # Science  — morning preference
        -0.05,  # History  — neutral/afternoon
        -0.10,  # English  — slight afternoon
        0.20,   # CS       — strong morning preference
        -0.05,  # Language — neutral
        -0.10,  # Art      — afternoon
        0.0,    # Other    — neutral
    ]
    w_paper = -0.15     # paper-based → slight afternoon push
    w_duration = 0.05   # longer tasks → slight morning push (tackle big things early)
    w_urgency = 0.80    # deadline pressure is the dominant signal
    w_difficulty = 0.40 # harder tasks in the morning
    w_bias = 0.0        # neutral intercept (the priority offsets handle base ordering)

    return w_subject + [w_paper, w_duration, w_urgency, w_difficulty, w_bias]


# ---------------------------------------------------------------------------
#  Training: pairwise logistic regression via gradient descent
# ---------------------------------------------------------------------------

def train_weights(
    user_id: int,
    db,
    lr: float = 0.01,
    epochs: int = 50,
    l2_decay: float = 0.001,
) -> tuple[Optional[list[float]], float]:
    """Learn feature weights from pairwise comparisons using stochastic GD.

    For each pair (A > B), we want:
        w · f_A  >  w · f_B

    Define difference vector d = f_A - f_B.
    Minimize the pairwise logistic loss:
        L(w) = Σ log(1 + exp(-w · d))

    Gradient:  ∂L/∂w = Σ  -d · exp(-w·d) / (1 + exp(-w·d))
                        = Σ  -d · σ(-w·d)
              where σ(z) = 1/(1+exp(-z)) is the sigmoid.

    Returns (weights_list, final_loss) or (None, 0.0) if insufficient data.
    """
    from models import PairwiseComparison, Task, UserPreferences

    # 1) Load all pairwise comparisons for this user
    pairs = (
        db.query(PairwiseComparison)
        .filter(PairwiseComparison.user_id == user_id)
        .all()
    )

    if len(pairs) < 5:
        return None, 0.0  # insufficient data → use fallback

    # 2) Build difference vectors
    diffs: list[list[float]] = []
    for pair in pairs:
        task_a = db.query(Task).filter(Task.id == pair.task_a_id).first()
        task_b = db.query(Task).filter(Task.id == pair.task_b_id).first()
        if task_a and task_b:
            fa = encode_task(task_a)
            fb = encode_task(task_b)
            diffs.append([fa[i] - fb[i] for i in range(N_FEATURES)])

    if not diffs:
        return None, 0.0

    n_pairs = len(diffs)

    # 3) Initialize weights (warm-start from stored weights)
    weights = get_default_weights()  # start from defaults, not zeros
    pref = (
        db.query(UserPreferences)
        .filter(UserPreferences.user_id == user_id)
        .first()
    )
    if pref and pref.weights_json:
        try:
            stored = json.loads(pref.weights_json)
            if len(stored) == N_FEATURES:
                weights = [stored.get(str(i), weights[i]) for i in range(N_FEATURES)]
        except (json.JSONDecodeError, KeyError):
            pass

    # 4) Gradient descent
    for epoch in range(epochs):
        total_loss = 0.0
        grad = [0.0] * N_FEATURES

        for d in diffs:
            dot = sum(weights[i] * d[i] for i in range(N_FEATURES))

            # Numerically stable logistic loss
            if dot > 20:
                # exp(-dot) ≈ 0, log(1+0) ≈ 0
                loss = 0.0
                factor = 0.0
            elif dot < -20:
                # exp(-dot) is huge, log(1+exp(-dot)) ≈ -dot
                loss = -dot
                factor = -1.0
            else:
                exp_neg = math.exp(-dot)
                loss = math.log1p(exp_neg)  # log(1 + exp(-dot)) — numerically stable
                factor = -exp_neg / (1.0 + exp_neg)

            total_loss += loss
            for i in range(N_FEATURES):
                grad[i] += factor * d[i]

        avg_loss = total_loss / n_pairs

        # Update weights
        for i in range(N_FEATURES):
            # Gradient step
            weights[i] -= lr * grad[i] / n_pairs
            # L2 regularization (weight decay)
            weights[i] -= lr * l2_decay * weights[i]

    return weights, round(avg_loss, 6)


# ---------------------------------------------------------------------------
#  Recording pairwise comparisons from a reorder event
# ---------------------------------------------------------------------------

def record_pairwise_comparisons(
    user_id: int,
    ordered_task_ids: list[int],
    db,
    max_pairs_per_user: int = 500,
) -> int:
    """Given an ordered list of task IDs (first = highest ranked),
    record all (A > B) pairs where A appears before B.

    Deduplicates existing pairs. Caps total pairs at max_pairs_per_user.
    Returns the number of NEW pairs recorded.
    """
    from models import PairwiseComparison

    # Get existing pairs to skip duplicates
    existing = set()
    old_pairs = (
        db.query(PairwiseComparison)
        .filter(PairwiseComparison.user_id == user_id)
        .all()
    )
    for p in old_pairs:
        existing.add((p.task_a_id, p.task_b_id))

    # Cap check
    current_count = len(old_pairs)
    new_count = 0

    # Generate all A > B pairs from the ordering
    n = len(ordered_task_ids)
    for i in range(n):
        for j in range(i + 1, n):
            task_a = ordered_task_ids[i]  # higher ranked ⭐
            task_b = ordered_task_ids[j]  # lower ranked

            if task_a == task_b:
                continue
            if (task_a, task_b) in existing:
                continue
            if current_count + new_count >= max_pairs_per_user:
                break

            pair = PairwiseComparison(
                user_id=user_id,
                task_a_id=task_a,
                task_b_id=task_b,
            )
            db.add(pair)
            existing.add((task_a, task_b))
            new_count += 1

    db.commit()
    return new_count


# ---------------------------------------------------------------------------
#  Time helpers
# ---------------------------------------------------------------------------

def parse_time_str(s: str) -> int:
    """Convert 'HH:MM' string to minutes since midnight."""
    try:
        s = s.strip()
        # Handle 12-hour format e.g. "7:00 AM" gracefully
        if " " in s:
            from datetime import datetime as dt
            try:
                t = dt.strptime(s, "%I:%M %p")
                return t.hour * 60 + t.minute
            except ValueError:
                pass
        h, m = s.split(":")
        return int(h) * 60 + int(m)
    except (ValueError, TypeError):
        return 0


def fmt_time(total_minutes: int) -> str:
    """Convert minutes since midnight to 'H:MM AM/PM' string."""
    total_minutes = total_minutes % (24 * 60)
    h = total_minutes // 60
    m = total_minutes % 60
    ampm = "AM" if h < 12 else "PM"
    h12 = h if 1 <= h <= 12 else (h - 12 if h > 12 else 12)
    if h == 0:
        h12 = 12
    return f"{h12}:{m:02d} {ampm}"


def fmt_time_24h(total_minutes: int) -> str:
    """Convert minutes since midnight to 'HH:MM' 24-hour string (for HTML time inputs)."""
    total_minutes = total_minutes % (24 * 60)
    h = total_minutes // 60
    m = total_minutes % 60
    return f"{h:02d}:{m:02d}"


def parse_deadline(s: str) -> str | None:
    """Normalize deadline string to 'YYYY-MM-DD HH:MM' format.
    Accepts: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:MM', 'YYYY-MM-DD HH:MM'.
    Returns None if unparseable.
    """
    if not s:
        return None
    s = s.strip()
    # Already in correct format
    if len(s) == 16 and s[10] == " " and s[13] == ":":
        return s
    # ISO format with T separator: 'YYYY-MM-DDTHH:MM'
    if len(s) >= 16 and "T" in s:
        try:
            from datetime import datetime as dt
            d = dt.fromisoformat(s)
            return d.strftime("%Y-%m-%d %H:%M")
        except (ValueError, TypeError):
            pass
    # Date only: 'YYYY-MM-DD' → add default time 23:59
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return s + " 23:59"
    return s
