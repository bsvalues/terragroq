# WilliamOS Unified System Architecture

Work order: WO-SHELL-001
Title: WilliamOS Unified System Architecture
Type: Architecture / Product Doctrine
Risk: Low, documentation and planning only

## Purpose

WilliamOS is a single personal operating environment for the Primary Operator.
This document defines the product doctrine, permanent system architecture, and
language rules that future screens, services, agents, and work orders must
follow.

This document does not authorize runtime behavior changes.

## Product Doctrine

WilliamOS is not:

- a business SaaS platform
- a project management application
- a team collaboration workspace
- an AI productivity tool
- a generic chatbot

WilliamOS is a private operating environment for a single Primary Operator that
governs projects, intelligence, evidence, memory, systems, and authorized
execution.

Everything in the ecosystem exists inside WilliamOS. WilliamOS is the operating
environment. Everything else is a subsystem.

## Core Design Principles

### One System

The Primary Operator should always feel like they are inside WilliamOS.
Subsystems should not feel like separate applications. Moving between areas
should feel like moving through rooms in one house.

### Primary Operator First

WilliamOS is designed for one Primary Operator. Interfaces should not assume
organizations, teams, multiple administrators, or shared workspaces.

Authority begins with the Primary. Additional operators, if ever introduced, are
delegated rather than foundational.

### Calm Intelligence

WilliamOS should feel quiet, trustworthy, prepared, evidence-driven, and
context-aware.

Avoid flashy animations, AI hype language, gamification, artificial
personality, and unnecessary notifications.

### Governed Execution

WilliamOS may prepare work. WilliamOS must not execute work requiring authority
without authorization.

Preparation is encouraged. Autonomous action is governed. Evidence accompanies
execution.

## Permanent Information Architecture

WilliamOS contains these permanent top-level areas:

- Home
- Projects
- Brain Council
- Hermes
- Agent Forge
- Work Orders
- Evidence
- Memory
- Systems
- Settings

These categories form the permanent information architecture. New capabilities
should fit into one of these areas unless a future doctrine update explicitly
changes the system map.

## System Areas

### Home

The Primary Home is not a dashboard. It is a status briefing.

Home answers:

- What needs attention?
- What changed?
- What is stable?
- What is blocked?
- What is recommended next?

Home should remain calm and uncluttered.

### Projects

Projects represent real operational systems and efforts, such as TerraFusion
OS, Benton County initiatives, future commercial products, research efforts,
and internal tooling.

Each project has its own context while remaining inside WilliamOS.

### Brain Council

Brain Council provides strategic reasoning, long-term planning, architectural
review, advisory recommendations, and synthesis.

Brain Council does not execute production actions. It advises.

### Hermes

Hermes is the execution subsystem. Its responsibilities include governed
automation, deployment workflows, operational execution, and environment
interactions.

Hermes respects authority gates. Hermes executes only when authorized.

### Agent Forge

Agent Forge creates and manages specialized agents. Its responsibilities include
agent definitions, capabilities, prompts, lifecycle, and governance.

Agent Forge expands WilliamOS without changing the identity of WilliamOS.

### Work Orders

Every meaningful change begins with a Work Order.

Work Orders define objective, scope, allowed changes, blocked changes,
validation, evidence, and completion. They are the governance backbone of
WilliamOS.

### Evidence

Evidence answers one question: how do we know this is true?

Evidence includes validation reports, production verification, test results,
deployment records, and readiness reports. Evidence is factual. It is never
aspirational.

### Memory

Memory provides continuity. It stores important decisions, architecture,
preferences, historical context, and operational knowledge.

Memory should distinguish temporary context, durable knowledge, and verified
facts.

### Systems

Systems contains operational health: authentication, runtime, infrastructure,
deployments, environments, diagnostics, and security readiness.

Systems is for operational awareness rather than daily work.

### Settings

Settings contains configuration visibility and owner-controlled preferences.
Settings should make authority boundaries explicit and should not hide risky
state changes behind casual controls.

## Navigation Philosophy

Navigation should be shallow. The Primary Operator should reach any major
capability within two interactions.

Every screen should answer:

- Where am I?
- What is happening?
- What can I do?
- What requires authority?

Subsystem names should serve orientation, not branding fragmentation.

## Language Doctrine

Preferred language:

- Home
- Primary
- Operator
- Projects
- Council
- Systems
- Memory
- Evidence
- Authority
- Readiness
- Next Move
- Attention

Avoid language:

- Workspace
- Team
- Organization
- Productivity
- AI-powered
- Dashboard as the primary identity
- Collaboration
- Admin Portal
- Growth language
- Marketing language

WilliamOS should feel personal, calm, capable, trusted, deliberate,
intelligent, and evidence-based. It should not feel noisy, gimmicky,
theatrical, corporate, or over-automated.

## Subsystem Identity Rules

WilliamOS is the operating environment.

Brain Council, Hermes, Agent Forge, Work Orders, Evidence, Memory, Systems, and
Projects are subsystems. They should never be presented as separate products
that compete with WilliamOS for identity.

TerraGroq is legacy repo/product naming. User-facing copy should avoid implying
that WilliamOS is powered by Groq or xAI.

## Future Work Order Evaluation

Every future work order should be evaluated against this question:

Does this make WilliamOS feel more like one coherent operating environment for
the Primary Operator, or more like another separate application?

Prefer the first outcome. If a feature creates fragmentation, the work order
should be redesigned before implementation.

## Success Criteria

WO-SHELL-001 is complete when:

- WilliamOS has a documented permanent architecture.
- Every subsystem has a clearly defined role.
- Product doctrine is established.
- Naming principles are documented.
- Future work orders have a stable architectural foundation.
- No runtime behavior has changed.

## Recommended Next Work Orders

1. WO-SHELL-002 - Navigation & Information Architecture
2. WO-SHELL-003 - Primary Home Experience
3. WO-SHELL-004 - Project Context Model
4. WO-SHELL-005 - Brain Council Integration
5. WO-SHELL-006 - Hermes Integration
6. WO-SHELL-007 - Agent Forge Integration

