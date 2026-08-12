"""CAPG — Command Approval Policy Gate. Deterministic DENY/ASK/ALLOW classifier that fixes
the Hermes finding (exfil/lateral-SSH misclassified as ALLOW) with a fail-closed default.

    from capg import classify, Decision
    v = classify("ssh atlas cat /root/secret")   # -> Decision.DENY, category lateral-movement
"""
from .gate import Command, Decision, Rule, Verdict, classify
from .rules import DEFAULT_RULES

__all__ = ["classify", "Decision", "Verdict", "Rule", "Command", "DEFAULT_RULES"]
__version__ = "0.1.0"
