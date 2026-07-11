# Ratio Study Knowledge Reference

Work Order: `WO-COUNTY-007`

## Purpose

Define the evidence needed for a reproducible property-tax ratio study without
loading sales, parcels, or assessment records.

Current public starting points include the Washington Department of Revenue
[property-tax resources](https://dor.wa.gov/taxes-rates/property-tax), including
its ratio-study information and annual ratio-study materials. Applicable law,
DOR instructions, and adopted professional standards must be verified for the
study year.

## Study Contract

Every study should declare:

- purpose and decision supported;
- population and property class;
- geography and time period;
- valuation date and assessment year;
- sale source and extraction date;
- validity screening and exclusion rules;
- treatment of transfers, resales, splits, combinations, new construction,
  partial interests, atypical financing, and related-party transactions;
- assessed-value source and current-record rule;
- stratification plan;
- statistics and confidence measures;
- minimum sample and fallback treatment;
- reviewer and approval state.

## Reproducible Flow

1. freeze source extracts and hashes;
2. normalize identifiers and dates;
3. join sales to the controlling assessed value with cardinality checks;
4. apply documented validity screens;
5. calculate ratios before trimming;
6. inspect extremes and influence without deleting inconvenient observations;
7. apply only declared outlier policy;
8. calculate required level, uniformity, and vertical-equity measures;
9. stratify by declared market-relevant characteristics;
10. reconcile totals and excluded-sale counts;
11. review results, limitations, and practical significance;
12. publish an evidence packet with code/model version and rerun instructions.

## Evidence Expectations

- counts at every stage;
- exclusion reason for every removed observation;
- before/after distribution summaries;
- measures such as median ratio, weighted mean, mean, COD, PRD or PRB when
  appropriate to the governing standard;
- confidence intervals or uncertainty statements where required;
- maps or charts that avoid owner information;
- narrative explaining limitations and whether results support the intended
  decision.

## Guardrails

- Do not optimize screening rules to force a preferred statistic.
- Do not mix assessment years or valuation dates silently.
- Do not treat a small or nonrepresentative sample as countywide truth.
- Do not infer causation from a ratio pattern alone.
- Do not publish parcel- or owner-level records from this reference.
- Preserve invalid and excluded records in controlled evidence rather than
  erasing them.

## Boundary

This page performs no analysis and contains no real sale, parcel, assessment,
or taxpayer data.
