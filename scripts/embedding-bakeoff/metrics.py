"""Retrieval metrics for the WilliamOS sovereign-embedding bake-off. Pure functions,
stdlib only, deterministic. Relevance is binary (a doc id is gold or not)."""
import math


def recall_at_k(ranked_ids, gold, k):
    """Fraction of gold docs present in the top-k. None for no-gold queries."""
    if not gold:
        return None
    topk = set(ranked_ids[:k])
    return sum(1 for g in gold if g in topk) / len(gold)


def mrr(ranked_ids, gold):
    """Reciprocal rank of the first gold doc. None for no-gold queries."""
    if not gold:
        return None
    gold = set(gold)
    for i, d in enumerate(ranked_ids, start=1):
        if d in gold:
            return 1.0 / i
    return 0.0


def ndcg_at_k(ranked_ids, gold, k):
    """Binary-relevance nDCG@k. None for no-gold queries."""
    if not gold:
        return None
    gold = set(gold)
    dcg = sum(1.0 / math.log2(i + 1) for i, d in enumerate(ranked_ids[:k], start=1) if d in gold)
    ideal = sum(1.0 / math.log2(i + 1) for i in range(1, min(len(gold), k) + 1))
    return dcg / ideal if ideal > 0 else 0.0


def near_dup_ok(ranked_ids, gold, distractor):
    """1.0 if a gold doc outranks the designated near-duplicate distractor, else 0.0.
    None when the query is not a near-dup case."""
    if not gold or distractor is None:
        return None
    gold = set(gold)
    gi = next((i for i, d in enumerate(ranked_ids) if d in gold), None)
    di = next((i for i, d in enumerate(ranked_ids) if d == distractor), None)
    if gi is None:
        return 0.0
    if di is None:
        return 1.0
    return 1.0 if gi < di else 0.0


def mean(values):
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def false_positive_rate(no_gold_top1_sims, threshold):
    """Fraction of no-gold queries whose top-1 similarity meets/exceeds the threshold
    (i.e. the model confidently retrieves something when nothing is correct)."""
    if not no_gold_top1_sims:
        return None
    return sum(1 for s in no_gold_top1_sims if s >= threshold) / len(no_gold_top1_sims)


def median(values):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    n = len(vals)
    mid = n // 2
    return vals[mid] if n % 2 else (vals[mid - 1] + vals[mid]) / 2.0
