# 17 — Elastic Compute Security and Lifecycle Reconciliation

## Purpose

Prevent IF-10 from turning "cloud VRAM" into an unmanaged second infrastructure plane. Elastic compute must enter WilliamOS as a bounded, work-owned Execution Fabric resource whose identity, authority, data access, network behavior, spend and lifecycle are independently governed.

## Existing doctrine to preserve

Current WilliamOS architecture already establishes several controlling principles:

- HERMES remains the resident supervisor/control plane; external providers/workers are subordinate and disposable.
- OMEN is nonessential; resident work survives client loss.
- workers/models do not receive raw machine/provider credentials merely because they are executing work;
- bounded execution and authority remain separate from provider reachability;
- placement/recommendation cannot mint authority;
- provider failure is typed and recoverable/reroutable;
- protected data movement requires explicit authority/policy, not model discretion;
- local-first/no-silent-external-fallback behavior remains controlling until explicitly changed.

IF-10 must extend these rules to remote accelerators rather than create a cloud-specific exception.

## Critical distinction

The following are different trust classes and must remain separate:

1. **External model API** — prompts/context are processed by a provider-managed model/service.
2. **Private rented accelerator** — WilliamOS provisions compute and runs an admitted runtime/model there, but infrastructure remains provider-hosted.
3. **Private owned/colocated node** — long-lived node under owner control, potentially promotable into the normal Fabric after separate admission.
4. **On-prem resident node** — existing HERMES/ATLAS/AEGIS class.

"Cloud allowed" is not a sufficient policy.

## Required resource lifecycle

An ephemeral remote accelerator must be owned by one authorized work binding and move through an explicit lifecycle:

`REQUESTED -> PROVISIONING -> ATTESTING -> ADMITTED -> ACTIVE -> SETTLING -> WIPING -> DESTROYING -> DESTROYED`

Failure states must preserve enough provider/resource identity for an orphan sweeper to find and terminate paid resources without retaining work data unnecessarily.

No remote worker becomes a permanent Fabric node merely by being reachable.

## Identity and credential separation

At minimum distinguish:

- provider control-plane credential used by HERMES/broker to provision/destroy resources;
- ephemeral worker identity used by the new resource to authenticate back to WilliamOS;
- model-provider/API credentials, if any, which are separate again;
- repository/tool credentials, which remain separately scoped and should normally not exist on inference-only workers.

Master provider credentials must never be copied into the worker image, prompt, model context, environment inherited by tools, logs or retained artifacts.

Prefer short-lived/scoped worker identity minted only after the control plane binds provider resource identity to the authorized work.

## Attestation

Before admission, record at minimum:

- provider resource/instance identity;
- region/zone when relevant to data policy;
- accelerator type/count/VRAM;
- machine/image identity/digest where available;
- runtime/container/image digest;
- network policy;
- storage policy;
- worker identity fingerprint;
- creation time and maximum TTL;
- spend ceiling;
- work/placement/authority binding.

Self-reported worker hardware is insufficient by itself for consequential placement.

## Data and egress policy

Policy must independently govern whether the remote resource may receive or emit:

- owner prompt text;
- canonical Thread context;
- retrieved documents/artifacts;
- repository bytes;
- embeddings;
- KV/prefix/semantic cache state;
- model weights or derived quantizations;
- evaluation corpora;
- logs/telemetry;
- generated outputs;
- outbound Internet requests/tool calls.

A private rented GPU may be allowed to execute a workload while still having **no general Internet egress**.

## Storage doctrine

Prefer no durable work storage. Scratch storage must be work-scoped and TTL-bounded. If provider boot/image caches persist outside the worker lifecycle, that behavior must be known and classified before sensitive work is admitted.

"Delete VM" is not automatically evidence that every provider-side snapshot/cache/log was erased. The evidence contract must distinguish what WilliamOS proved from what the provider contract merely asserts.

## Spend and orphan control

Before provisioning, bind:

- maximum hourly rate or provider price observation;
- maximum total spend;
- maximum TTL;
- maximum retry/provision attempts;
- currency and observed-at timestamp;
- owner/standing spend authority reference.

The orphan sweeper must be able to enumerate only resources created under the WilliamOS provider namespace/tagging contract and destroy expired/unbound resources without treating arbitrary provider assets as its authority.

Unknown price is not zero-price. Uncertain destruction is not DESTROYED.

## Failure handling

Typed failures should distinguish at least:

- `ELASTIC_PROVIDER_UNAVAILABLE`
- `ELASTIC_CAPACITY_UNAVAILABLE`
- `ELASTIC_PROVISION_FAILED`
- `ELASTIC_ATTESTATION_FAILED`
- `ELASTIC_IDENTITY_FAILED`
- `ELASTIC_NETWORK_POLICY_FAILED`
- `ELASTIC_RUNTIME_FAILED`
- `ELASTIC_MODEL_LOAD_FAILED`
- `ELASTIC_BUDGET_EXCEEDED`
- `ELASTIC_TTL_EXCEEDED`
- `ELASTIC_POLICY_DENIED_DATA`
- `ELASTIC_WIPE_UNPROVEN`
- `ELASTIC_DESTROY_FAILED`
- `ELASTIC_ORPHAN_DETECTED`

Normal recovery may re-place to another policy-eligible local/private/API candidate; it may not weaken privacy/spend/authority gates to make progress.

## What IF-10 should reuse

IF-00 must classify and reuse/adapt current owners for:

- Work Order/Thread/authority binding;
- Execution Fabric placement receipts;
- canonical node/resource identity patterns;
- reservation/protected-resource/fencing primitives where applicable;
- bounded execution contracts;
- evidence/provenance receipts;
- provider availability/failure semantics;
- existing secret/tool boundaries;
- HERMES continuation/recovery.

## What is likely genuinely new

Unless current-main evidence proves otherwise:

- provider provisioning adapter(s);
- ephemeral-resource attestation contract;
- short-lived remote worker identity issuance;
- provider-specific network/storage confinement;
- spend/TTL binding and resource tagging;
- orphan enumeration/sweeping;
- wipe/destroy evidence;
- region/data-residency constraints;
- elastic-price observation.

## V1 admission posture

The first elastic proof should use non-sensitive synthetic/public workload data and one provider only. Do not use county/protected data to prove plumbing.

The terminal proof must show success and induced failure paths both destroy the resource and leave sufficient evidence to explain placement, spend, lifecycle and cleanup.

## Acceptance

Elastic reconciliation passes only when:

- remote compute remains subordinate to HERMES and existing authority;
- provider control credentials never reach model/worker context;
- worker identity is work/resource scoped and short-lived;
- API-vs-private-GPU trust classes are explicit;
- egress/data categories are independently policyable;
- spend and TTL are hard gates before provisioning;
- success and failure both settle/wipe/destroy or surface typed unresolved cleanup;
- an orphan sweeper cannot delete resources outside its admitted namespace;
- no protected-data demonstration is required for V1;
- local-first/no-silent-fallback remains intact until separately authorized.
