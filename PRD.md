# Codemedics

## IBM Bob 2.0 Hackathon — MVP Product Requirements Document

**Project Name:** Codemedics
**Hackathon:** IBM Bob 2.0 Hackathon
**Build Period:** 48 hours
**Team:** 2 members
**IBM Bob Access:** Enterprise
**Bobcoin Allocation:** 40 Bobcoins per member
**Total Team Allocation:** 80 Bobcoins
**Product Scope:** Focused MVP / Working Proof of Concept
**Primary Development Tool:** IBM Bob IDE
**Development Approach:** Step-by-step, approval-based, agent-assisted development

---

# 1. Document Purpose

This PRD defines the complete MVP scope for **Codemedics**.

The PRD is intentionally designed for:

* a 48-hour hackathon
* a two-person beginner team
* IBM Bob 2.0 as the primary AI development partner
* 40 Bobcoins per team member
* minimum unnecessary Bobcoin consumption
* step-by-step agent execution
* controlled and reviewable changes
* a working end-to-end demonstration
* clear evidence of meaningful IBM Bob usage

The project must prioritize a **working core workflow** over a large number of incomplete features.

---

# 2. Product Overview

## 2.1 Product Name

**Codemedics**

## 2.2 Product Meaning

The name combines:

**Code + Medics**

The product treats a software repository like a patient:

```text
Repository
    ↓
Checkup
    ↓
Diagnosis
    ↓
Prescription
    ↓
Treatment
    ↓
Verification
```

---

# 3. Product Vision

Codemedics is an AI-powered **codebase health assistant** that helps developers understand the health of an existing repository, identify important problems, create a prioritized treatment plan, apply one controlled improvement, and verify the result.

The product is not intended to automatically repair an entire codebase.

Instead, it provides a controlled workflow:

```text
SCAN
  ↓
DIAGNOSE
  ↓
PRESCRIBE
  ↓
APPROVE
  ↓
TREAT
  ↓
VERIFY
  ↓
SHOW IMPACT
```

---

# 4. Problem Statement

When developers work with an unfamiliar or unhealthy codebase, they often need to perform many tasks manually:

* understand project structure
* identify important files
* understand configuration
* inspect testing coverage
* inspect documentation
* identify maintenance problems
* determine priorities
* decide what should be fixed
* implement changes
* run tests
* verify the changes
* determine whether the repository actually improved

This process can require considerable manual effort.

Codemedics aims to organize these activities into a structured AI-assisted workflow.

---

# 5. Target User

## Primary User

Developers working on existing software repositories.

Examples:

* students
* junior developers
* developers joining an existing project
* developers maintaining old projects
* developers reviewing a repository before making changes
* developers preparing a project for further development

---

# 6. Core MVP Objective

The MVP must allow a user to:

> **Provide a supported repository, receive a health assessment, understand prioritized problems, receive a treatment prescription, approve one treatment, apply it, verify the result, and see a before/after comparison.**

That single workflow is the definition of the MVP.

---

# 7. Hackathon Alignment

Codemedics is designed around the IBM Bob 2.0 concept of improving a real software-development workflow.

IBM Bob is positioned as an AI SDLC partner that can work with real codebases, generate and modify code, debug, document, answer repository questions, automate tasks, use specialized modes, and orchestrate subagents.

Codemedics must therefore demonstrate:

* meaningful repository-level work
* multi-step AI-assisted development
* actual implementation
* actual verification
* measurable improvement
* meaningful IBM Bob involvement

Bob must be a **core development component**, not merely a tool used to generate a few UI components.

---

# 8. Product Principle

## One workflow, executed completely.

We are **not** building:

> "An AI that fixes the entire repository."

We are building:

> "An AI-assisted workflow that diagnoses a repository and safely improves one selected problem."

This keeps the MVP achievable within 48 hours.

---

# 9. MVP Workflow

The complete Codemedics workflow is:

```text
1. Repository Input
        ↓
2. Repository Scan
        ↓
3. Health Assessment
        ↓
4. Diagnosis
        ↓
5. Prioritization
        ↓
6. Prescription
        ↓
7. Human Approval
        ↓
8. Controlled Treatment
        ↓
9. Verification
        ↓
10. Before / After Comparison
```

---

# 10. Important AI Design Rule

## The AI must work step-by-step.

The AI must **never** be instructed to build the entire Codemedics project at once.

Avoid prompts such as:

> Build the complete Codemedics application.

Avoid:

> Analyze the repository and automatically fix everything.

Instead, every major task must follow:

```text
Understand
    ↓
Plan
    ↓
Review
    ↓
Implement
    ↓
Test
    ↓
Verify
```

This approach is also aligned with IBM Bob's specialized modes and workflow capabilities. Bob provides **Ask, Plan, and Agent** modes specifically for different development situations.

---

# 11. Codemedics AI Agent Architecture

The MVP will use logically separate AI stages.

They do not necessarily need to be five different external models.

They can be implemented as focused tasks within the same AI ecosystem.

## Agent 1 — Explorer

### Responsibility

Understand the repository.

### Input

Supported repository.

### Output

Repository summary:

* project type
* directory structure
* important files
* configuration
* testing information
* documentation information
* dependency information

### Restrictions

Explorer must not:

* modify source files
* fix issues
* install unnecessary dependencies
* refactor the project

---

# 12. Agent 2 — Diagnostician

### Responsibility

Identify repository health problems.

### Input

Explorer results + repository evidence.

### Output

Structured findings.

Each finding contains:

* title
* category
* severity
* evidence
* affected file/path
* explanation
* suggested direction

### Restrictions

Diagnostician must not implement fixes.

---

# 13. Agent 3 — Prescription Planner

### Responsibility

Convert a selected diagnosis into an actionable treatment plan.

### Output

* treatment title
* reason
* expected result
* files likely to change
* verification strategy
* risk notes

### Restrictions

Prescription Planner must not implement the change.

---

# 14. Agent 4 — Treatment Agent

### Responsibility

Implement exactly **one approved treatment**.

### Input

Human-approved prescription.

### Output

Code/documentation changes.

### Restrictions

Treatment Agent must not:

* fix unrelated findings
* redesign the application
* change unrelated files
* silently expand scope

---

# 15. Agent 5 — Verification Agent

### Responsibility

Determine whether the treatment actually worked.

### Input

Modified repository + verification results.

### Output

* tests
* checks
* changed files
* pass/fail result
* comparison
* final recommendation

### Critical Rule

If verification fails, Codemedics must report failure.

It must never present an unverified fix as successful.

---

# 16. Human Approval Gates

Human control is mandatory at major workflow stages.

```text
SCAN
  ↓
Human Review
  ↓
DIAGNOSIS
  ↓
Human Review
  ↓
PRESCRIPTION
  ↓
Human Approval
  ↓
TREATMENT
  ↓
Human Review
  ↓
VERIFICATION
```

The user is always able to stop the process.

---

# 17. MVP Feature Requirements

## 17.1 Repository Input

The MVP should accept:

* public GitHub repository URL

The initial MVP should focus on repositories that use a JavaScript/package-based ecosystem where practical.

Potential initial support:

* JavaScript
* React
* Node.js
* package.json-based projects

The MVP should not attempt universal language support.

---

# 18. Repository Scanner

Codemedics must inspect the repository and extract useful evidence.

## Required scan areas

### Structure

* major directories
* source directories
* test directories
* configuration files
* documentation files

### Project configuration

* package.json
* scripts
* dependencies
* project metadata

### Testing

* test directories
* test files
* test scripts
* visible test configuration

### Documentation

* README presence
* documentation directories
* basic documentation availability

### Code-quality signals

The MVP may detect practical signals such as:

* TODO/FIXME markers
* suspiciously large files
* missing tests
* missing documentation
* obvious project-structure issues
* basic configuration inconsistencies
* simple maintainability indicators

### Dependency signals

Where safely available:

* dependency inventory
* basic dependency-health indicators
* obviously outdated or problematic configuration

---

# 19. Repository Health Score

Codemedics should calculate a simple health score.

Example:

```text
Repository Health: 68 / 100

Testing:        45
Documentation:  72
Structure:      80
Code Quality:   70
Dependencies:   75
```

The score must be:

* explainable
* based on visible evidence
* reproducible
* clearly identified as a Codemedics metric

It must not be presented as an industry-standard score.

---

# 20. Health Categories

The MVP should use a small number of categories.

Recommended:

1. Testing
2. Documentation
3. Structure
4. Code Quality
5. Dependencies

Do not add many categories unless they directly improve the core demo.

---

# 21. Diagnosis

After scanning, Codemedics produces a structured diagnosis.

Example:

```text
Finding:
Low automated test coverage

Severity:
High

Evidence:
Very few test files were detected.

Potential Impact:
Changes may be difficult to verify safely.

Recommended Action:
Add tests for important application logic.
```

Each finding should identify evidence instead of producing unsupported claims.

---

# 22. Prioritization

The user should not receive an overwhelming list.

Findings should be prioritized.

Severity options:

* Critical
* High
* Medium
* Low

Priority should be based on observable evidence and the likely development impact.

---

# 23. Prescription

Codemedics converts a selected finding into a treatment plan.

Example:

```text
Prescription

Problem:
Missing automated tests

Treatment:
Add tests for selected utility module

Expected Outcome:
Improve verification coverage for critical logic

Affected Area:
src/utils/

Verification:
Run targeted tests
```

---

# 24. Approval

Before changes are made, the user must approve the prescription.

Example:

```text
Treatment ready

Add tests for selected utility module.

[Approve Treatment]
[Cancel]
```

Only after approval may the treatment stage begin.

---

# 25. Controlled Treatment

The MVP should implement only **one treatment per workflow run**.

This is a deliberate product limitation.

The objective is:

> prove that Codemedics can safely move from diagnosis to verified improvement.

Not:

> automatically rewrite the repository.

---

# 26. Verification

Verification must rely on real checks wherever possible.

Examples:

* automated tests
* lint checks
* build checks
* targeted scripts
* file-existence checks
* configuration checks

Example:

```text
Verification

Tests: PASS
Lint: PASS
Build: PASS

Treatment:
Verified
```

Failure must also be displayed clearly.

---

# 27. Before/After Comparison

The final screen must demonstrate impact.

Example:

```text
BEFORE

Health Score: 61

Testing: 35
Documentation: 65
Code Quality: 70


AFTER

Health Score: 76

Testing: 60
Documentation: 65
Code Quality: 72
```

Then show:

```text
Improvement

+15 Health Score
6 tests added
6 tests passing
2 files changed
Verification: Passed
```

The exact score calculations will be finalized after the first implementation/testing cycle.

---

# 28. MVP UI

The MVP should have a small number of screens.

## Screen 1 — Landing / Repository Input

Contains:

* Codemedics logo/name
* short explanation
* repository URL input
* Analyze button

---

## Screen 2 — Scan Progress

Shows:

```text
Repository connected      ✓
Structure analyzed        ✓
Testing analyzed          ✓
Documentation analyzed    ✓
Diagnosis                  ...
```

---

## Screen 3 — Health Dashboard

Displays:

* overall score
* category scores
* repository summary
* most important findings

---

## Screen 4 — Diagnosis

Displays:

* issue
* severity
* evidence
* affected area
* explanation

---

## Screen 5 — Prescription

Displays:

* recommended treatment
* reason
* expected result
* affected files
* verification plan
* approval button

---

## Screen 6 — Verification / Comparison

Displays:

* before score
* after score
* treatment result
* tests/checks
* files changed
* impact summary

---

# 29. IBM Bob Enterprise Strategy

The team now has IBM Bob Enterprise access.

IBM's Enterprise functionality supports organizational teams and Bobcoin budgets, allowing administrators to manage team membership and spending.

Our project will treat the two members as a coordinated development team.

## Allocation

| Member    | Bobcoins |
| --------- | -------: |
| Member 1  |       40 |
| Member 2  |       40 |
| **Total** |   **80** |

The 40-per-member allocation is our hackathon working budget.

---

# 30. Bobcoin Goal

We should **not intentionally consume all 80 Bobcoins**.

Target:

> Complete the MVP using approximately **50–65 Bobcoins total**, while keeping the remaining 15–30 Bobcoins as emergency reserve.

Actual consumption depends on Bob's processing requirements.

IBM explains that Bobcoins are the usage metric for AI operations such as code generation, file analysis, and commands, and that consumption varies according to computational resources.

---

# 31. Bobcoin Conservation Principles

## Bob should do:

* architecture reasoning
* repository understanding
* difficult implementation
* debugging
* test generation
* code review
* verification assistance

## Humans should do:

* simple UI changes
* obvious text changes
* Git operations
* basic file movement
* screenshots
* straightforward configuration
* manual validation that requires no AI reasoning

---

# 32. Bob Context Optimization

Bobcoins should be treated as a limited engineering budget.

IBM's current guidance explains that Bobcoin consumption is affected by the amount of text/context processed, not simply by the number of tasks completed.

Therefore:

### Do

* keep tasks focused
* start a new task when the objective changes
* use concise prompts
* reference only relevant files
* maintain persistent project context
* store decisions in files
* verify changes before moving forward

### Avoid

* one massive conversation for the entire project
* repeatedly sending the same context
* asking Bob to repeat completed work
* using AI for trivial changes
* unnecessary multi-agent work

---

# 33. IBM Bob Project Initialization

At the beginning of development, Bob should initialize project context.

Use:

```text
/init
```

IBM's documentation states that `/init` generates an `AGENTS.md` file and mode-specific `.bob` context, allowing Bob to retain project structure and conventions across conversations.

This is important for reducing repeated repository analysis.

---

# 34. Bob Mode Strategy

## Ask Mode

Use for:

* understanding existing code
* asking questions
* learning
* reviewing architecture without modification

## Plan Mode

Use for:

* architecture
* complex feature planning
* diagnosing implementation strategy
* deciding which files should change

## Agent Mode

Use for:

* implementation
* debugging
* refactoring
* writing tests
* documentation
* executing approved tasks

IBM documents these three specialized modes as distinct workflows.

---

# 35. Subagent Strategy

Subagents are allowed but **not mandatory**.

IBM Bob can split complex work into focused parallel workstreams using subagents.

However, because Bobcoins are limited, subagents should only be used when parallelization clearly saves time or improves analysis.

## Good use

Example:

```text
Repository analysis
      ↓
 ┌───────────────┐
 │ Testing       │
 │ Documentation │
 │ Dependencies  │
 └───────────────┘
```

## Bad use

Using three subagents to create three simple UI components.

---

# 36. Team Division

## Member 1 — Core Product / Workflow

Primary responsibility:

> Build the main Codemedics application workflow.

### Responsibilities

* project setup
* repository input
* scan pipeline
* health dashboard
* workflow navigation
* prescription approval UI
* treatment workflow
* final integration

### Bob priorities

Use Bob for:

* architecture
* difficult implementation
* debugging
* integration
* final optimization

---

# 37. Member 2 — Intelligence / Verification

Primary responsibility:

> Build the diagnosis, prescription, testing, and verification side.

### Responsibilities

* health criteria
* findings model
* prioritization
* diagnosis
* prescriptions
* verification logic
* tests
* benchmark repositories/data
* before/after metrics
* quality review

### Bob priorities

Use Bob for:

* analysis
* test generation
* debugging
* code review
* verification
* documentation

---

# 38. Responsibilities Must Not Overlap

Both members should not ask Bob to solve the same task.

Example:

Wrong:

```text
Member 1 → Bob: Build diagnosis system
Member 2 → Bob: Build diagnosis system
```

Correct:

```text
Member 1 → Bob:
Integrate diagnosis results into the application.

Member 2 → Bob:
Design and implement the diagnosis engine.
```

---

# 39. Shared Git Workflow

Use one shared GitHub repository.

Suggested structure:

```text
main
├── member-1-core
└── member-2-analysis
```

Workflow:

```text
Task
  ↓
Implementation
  ↓
Commit
  ↓
Review
  ↓
Merge
  ↓
Test
```

Small commits are preferred.

---

# 40. Integration Strategy

Do not wait until the end to combine everything.

Integrate after every major feature.

Example:

```text
Scanner complete
      ↓
Merge
      ↓
Run test
      ↓
Diagnosis complete
      ↓
Merge
      ↓
Run test
```

---

# 41. Dataset Requirement

Codemedics must maintain a small benchmark dataset for demonstrating the product.

The dataset should consist of legally usable repositories or intentionally created benchmark repositories.

Recommended benchmark cases:

```text
Repository A
Healthy baseline

Repository B
Weak testing

Repository C
Weak documentation

Repository D
Multiple maintenance issues
```

The benchmark should make the before/after workflow easy to reproduce.

---

# 42. Dataset Safety

Do not use:

* private company repositories
* confidential projects
* personal information
* leaked credentials
* client data
* private API keys

Public repositories should only be used in accordance with applicable licenses and terms.

Maintain a simple `DATASET.md` containing:

* repository/source
* purpose
* license/source information
* how the data is used
* limitations

---

# 43. Security Requirements

IBM's current security guidance recommends restricting Bob's file access with `.bobignore`, limiting auto-approval settings, keeping secrets out of prompts/files, securing MCP connections, and reviewing Bob output before executing generated changes.

Therefore the MVP must:

* use `.bobignore`
* use `.gitignore`
* keep secrets in environment variables
* never commit API keys
* never commit GitHub tokens
* avoid unnecessary permissions
* review Bob-generated commands
* avoid unnecessary arbitrary code execution

---

# 44. Bob Approval Policy

During development:

### Default

Only read operations may be automatically approved.

### Require human approval for:

* modifying files
* running potentially destructive commands
* installing packages
* database changes
* deleting files
* changing configuration
* running external/network-sensitive operations

This keeps the first-time team safer while learning Bob.

---

# 45. Bob Session Evidence

Because Bob usage is important to the hackathon submission, each member should maintain meaningful task-session evidence.

Create:

```text
bob_sessions/
```

The directory should contain the relevant exported task-session records and required screenshots/evidence.

Do not fill it with meaningless sessions.

The evidence should show:

* what Bob was asked to do
* what Bob analyzed
* what Bob implemented
* what changed
* how the work was verified

---

# 46. Recommended Bob Session Structure

## Member 1

```text
01-project-context
02-architecture
03-repository-input
04-scanner
05-health-dashboard
06-integration
07-debugging
08-final-review
```

## Member 2

```text
01-analysis-rules
02-health-model
03-diagnosis
04-prescription
05-verification
06-tests
07-review
08-final-validation
```

These are logical task names, not a requirement to create exactly this number of sessions.

---

# 47. Bobcoin Allocation by Work Type

The allocation below is a planning guide.

| Work                | Member 1 | Member 2 |
| ------------------- | -------: | -------: |
| Context / planning  |      Low |      Low |
| Core implementation |   Medium |      Low |
| Analysis logic      |      Low |   Medium |
| Testing             |      Low |   Medium |
| Debugging           |   Medium |   Medium |
| Review              |      Low |      Low |
| Reserve             |     High |     High |

The goal is to preserve a reserve rather than spend the entire budget.

---

# 48. Bobcoin Stop Rules

Immediately stop using Bob for a task when:

* the expected result has been obtained
* the task starts expanding beyond its objective
* Bob begins modifying unrelated files
* the conversation becomes unnecessarily large
* repeated attempts are producing the same result

Then:

1. stop
2. review
3. save the useful result
4. start a focused new task if necessary

---

# 49. No Unnecessary AI

Not every part of the product needs an AI call.

For example:

```text
Score calculation
    → deterministic logic

Test execution
    → deterministic tool

Before/after comparison
    → deterministic logic

UI state changes
    → normal application logic
```

AI should handle tasks where reasoning adds real value:

```text
Repository understanding
Diagnosis
Prioritization
Prescription
Code changes
Review
```

This keeps Bobcoin usage low and improves reliability.

---

# 50. MVP Technology Principle

Technology choices should be based on:

1. fastest reliable implementation
2. team's existing knowledge
3. minimum integration complexity
4. compatibility with IBM Bob
5. ability to demonstrate the workflow clearly

Do not introduce a new technology simply because it sounds impressive.

---

# 51. Optional AI Tools

Other AI agents or AI APIs may be added only if they provide a clear benefit.

They must not replace IBM Bob as the core development partner.

Priority:

```text
IBM Bob
   ↓
Core MVP
   ↓
Testing
   ↓
Verification
   ↓
Optional enhancement
```

Not:

```text
Multiple AI platforms
    ↓
Complex orchestration
    ↓
No finished MVP
```

---

# 52. Out of Scope

The following are not required for the MVP:

* authentication
* subscription/payment
* enterprise user management
* mobile application
* browser extension
* IDE plugin
* continuous monitoring
* automated pull requests
* CI/CD integration
* GitHub OAuth
* private repository support
* complete vulnerability platform
* support for every programming language
* complete autonomous repair
* automatic repair of all findings
* large admin dashboard
* team analytics platform
* notification system

---

# 53. MVP Definition of Done

The MVP is complete only when this flow works:

```text
Public GitHub Repository
          ↓
Repository Scan
          ↓
Health Score
          ↓
Prioritized Diagnosis
          ↓
Prescription
          ↓
User Approval
          ↓
ONE Controlled Treatment
          ↓
Verification
          ↓
Before / After Result
```

---

# 54. 48-Hour Execution Plan

## Phase 1 — Setup

### Both members

* create GitHub repository
* install/update Bob
* connect Bob Enterprise accounts
* confirm 40 Bobcoin allocation per member
* configure `.gitignore`
* configure `.bobignore`
* initialize Bob with `/init`
* create shared documentation
* create baseline repository

### Completion gate

Both members can open the project in Bob and Bob understands the repository context.

---

# 55. Phase 2 — Architecture

### Member 1

Plan:

* application structure
* scan workflow
* health dashboard

### Member 2

Plan:

* diagnosis model
* finding structure
* treatment structure
* verification model

### Gate

Do not proceed until both members understand the architecture.

---

# 56. Phase 3 — Foundation

### Member 1

Implement:

* repository input
* repository scan
* initial health report

### Member 2

Implement:

* health rules
* finding model
* benchmark dataset

### Gate

A repository can produce a meaningful first assessment.

---

# 57. Phase 4 — Diagnosis

### Member 1

Integrate diagnosis into UI.

### Member 2

Implement:

* finding analysis
* severity
* prioritization
* evidence

### Gate

User can understand the major repository problems.

---

# 58. Phase 5 — Prescription

### Member 1

Build prescription screen and approval.

### Member 2

Build prescription generation.

### Gate

User can select one treatment and approve it.

---

# 59. Phase 6 — Treatment

### Member 1

Implement the approved treatment workflow.

### Member 2

Review generated changes and test them.

### Gate

Exactly one selected improvement is applied.

---

# 60. Phase 7 — Verification

### Member 2

Build verification process.

### Member 1

Integrate results into UI.

### Gate

The product clearly reports pass/fail.

---

# 61. Phase 8 — Before/After

Both members:

* calculate before score
* calculate after score
* show files changed
* show tests
* show verification
* show improvement

### Gate

The demo clearly communicates measurable impact.

---

# 62. Phase 9 — Stabilization

Test:

* valid repository
* invalid URL
* unsupported repository
* repository with no tests
* repository with weak documentation
* repository with multiple findings
* successful treatment
* failed treatment
* verification failure
* network failure

No major features should be added here.

---

# 63. Phase 10 — Submission Preparation

### Both members

Prepare:

* README
* PRD
* architecture documentation
* dataset documentation
* Bob workflow documentation
* Bob session evidence
* screenshots
* demo scenario
* final repository

Also verify:

* no secrets
* no broken links
* no unnecessary files
* no unfinished core features

---

# 64. Recommended Repository Documentation

The final repository should contain:

```text
README.md
PRD.md
ARCHITECTURE.md
DATASET.md
BOB_WORKFLOW.md
DEMO.md
bob_sessions/
```

Each document should be concise and useful.

---

# 65. README Requirements

README should explain:

1. What is Codemedics?
2. What problem does it solve?
3. How does the workflow work?
4. How is IBM Bob involved?
5. How is the MVP demonstrated?
6. How can the project be run?
7. What is intentionally out of scope?

---

# 66. Demo Story

The final demonstration should be extremely simple.

### Opening

> "This repository has health problems."

### Step 1

Connect repository.

### Step 2

Run scan.

### Step 3

Show health score.

### Step 4

Show diagnosis.

### Step 5

Open prescription.

### Step 6

Approve one treatment.

### Step 7

Apply treatment.

### Step 8

Run verification.

### Step 9

Show before/after.

### Closing

> "Codemedics turns repository diagnosis into a controlled, verified improvement."

---

# 67. Success Metrics

The MVP should demonstrate:

### Workflow metrics

* scan completed
* diagnosis generated
* prescription generated
* treatment applied
* verification completed

### Improvement metrics

* health score change
* number of tests added
* number of issues addressed
* verification status
* files changed

### Productivity story

Where possible, demonstrate:

* fewer manual steps
* faster diagnosis
* reduced repetitive work
* safer changes through approval
* automated verification

Do not invent time savings.

Measure them during testing if possible.

---

# 68. Product Safety Principle

Codemedics must follow:

> **Explain before modifying. Approve before treating. Verify before claiming success.**

This is a core product principle.

---

# 69. Beginner Rule

Because this is the team's first hackathon:

### Never jump directly to the final architecture.

At every stage:

```text
Understand
    ↓
Ask Questions
    ↓
Plan
    ↓
Implement Small Piece
    ↓
Test
    ↓
Review
    ↓
Continue
```

We will only move to the next feature when the current feature works.

---

# 70. Final Architecture Philosophy

Codemedics should be:

* small
* modular
* understandable
* testable
* explainable
* demoable
* safe
* Bob-assisted

It should **not** be:

* over-engineered
* fully autonomous
* dependent on many AI services
* overloaded with dashboards
* overloaded with integrations

---

# 71. Final MVP Scope

The entire Codemedics MVP can be summarized as:

```text
                 CODEMEDICS

              Repository URL
                    │
                    ▼
              ┌───────────┐
              │   SCAN    │
              └─────┬─────┘
                    │
                    ▼
              ┌───────────┐
              │  HEALTH   │
              │  REPORT   │
              └─────┬─────┘
                    │
                    ▼
              ┌───────────┐
              │ DIAGNOSE  │
              └─────┬─────┘
                    │
                    ▼
              ┌───────────┐
              │PRESCRIBE  │
              └─────┬─────┘
                    │
               USER APPROVAL
                    │
                    ▼
              ┌───────────┐
              │  TREAT    │
              └─────┬─────┘
                    │
                    ▼
              ┌───────────┐
              │  VERIFY   │
              └─────┬─────┘
                    │
                    ▼
              ┌───────────┐
              │ BEFORE /  │
              │   AFTER   │
              └───────────┘
```

---

# 72. IBM Bob Development Philosophy

Our development process will mirror the product philosophy:

```text
EXPLORE
  ↓
PLAN
  ↓
IMPLEMENT
  ↓
VERIFY
```

Bob's specialized modes, repository context, subagents, file operations, command execution, and project-context tooling are available to support these stages.

---

# 73. Final Rules for the Team

## Rule 1

Do not ask Bob to build the whole project.

## Rule 2

One major objective per Bob task.

## Rule 3

Use Plan mode before complicated implementation.

## Rule 4

Use Agent mode only after the implementation scope is clear.

## Rule 5

Review Bob's changes.

## Rule 6

Run tests/checks after every important change.

## Rule 7

Keep Bob contexts focused.

## Rule 8

Track Bobcoin consumption.

## Rule 9

Preserve a Bobcoin reserve.

## Rule 10

Do not duplicate Bob tasks between team members.

## Rule 11

Keep Bob evidence from meaningful sessions.

## Rule 12

Do not add features that do not improve the core workflow.

---

# 74. Final Team Objective

The goal is **not**:

> Build the largest application.

The goal is:

> **Build a small, polished, working developer workflow that clearly demonstrates how IBM Bob can help diagnose, improve, and verify a real codebase.**

The final Codemedics experience should communicate:

```text
Problem
   ↓
Understanding
   ↓
Diagnosis
   ↓
Treatment
   ↓
Verification
   ↓
Measurable Improvement
```

And our own development process should demonstrate:

```text
Bob
 ↓
Focused Task
 ↓
Human Review
 ↓
Implementation
 ↓
Verification
```

---

# 75. MVP Acceptance Checklist

## Product

* [ ] Repository URL accepted
* [ ] Repository scanned
* [ ] Health score generated
* [ ] Findings generated
* [ ] Findings prioritized
* [ ] Prescription generated
* [ ] User approval required
* [ ] One treatment implemented
* [ ] Verification executed
* [ ] Before/after shown

## AI

* [ ] Explorer stage
* [ ] Diagnosis stage
* [ ] Prescription stage
* [ ] Treatment stage
* [ ] Verification stage
* [ ] No whole-project autonomous prompt
* [ ] Human approval gates

## IBM Bob

* [ ] IBM Bob IDE used as primary development tool
* [ ] Both members use Bob
* [ ] Bob tasks are meaningful
* [ ] Bobcoin usage monitored
* [ ] Project context initialized
* [ ] Relevant Bob session evidence preserved
* [ ] No unnecessary Bobcoin usage
* [ ] No secrets exposed
* [ ] Bob version is current enough for the hackathon

## Team

* [ ] Member 1 core workflow complete
* [ ] Member 2 analysis/verification complete
* [ ] Integration tested
* [ ] No duplicated major tasks
* [ ] Git history organized

## Data

* [ ] Benchmark dataset prepared
* [ ] Sources documented
* [ ] Data usage is lawful
* [ ] No confidential information
* [ ] No secrets

## Submission

* [ ] README
* [ ] PRD
* [ ] Architecture
* [ ] Dataset documentation
* [ ] Bob workflow documentation
* [ ] Bob session evidence
* [ ] Final demo
* [ ] Final repository verified

---

# 76. Final Product Definition

**Codemedics is an AI-powered codebase health assistant that scans a repository, diagnoses important problems, prescribes a prioritized treatment, applies one approved improvement, verifies the result, and demonstrates measurable before/after impact.**

The MVP is complete when that workflow works reliably from beginning to end.

Everything else is optional.
