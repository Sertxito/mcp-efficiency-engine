---
layout: default
title: MCP Efficiency Engine
---

# MCP Efficiency Engine

**Enterprise-grade orchestration, routing, and spec-driven development for AI agents and MCP servers.**

An operational framework for managing agents, skills, and knowledge across complex cloud and on-premises environments with built-in observability, token optimization, and compliance.

---

## 🚀 Quick Start

1. **[Onboarding Guide](01-onboarding.md)** — Get started with the engine
2. **[Routing Guide](03-mcp-routing-guide.md)** — Understand agent routing decisions
3. **[Agent Usage Guide](04-agent-usage-guide.md)** — Deploy and configure agents
4. **[Usage Patterns](../FINAL_USAGE_GUIDE.md)** — Real-world scenarios

---

## 📚 Documentation by Topic

### Optimization & Performance

- **[Token Savings Guide](00-Ahorro_Tokens.md)** — Reduce token usage with Caveman Mode and Token Saver
- **[Always-On Optimization](02-always-on-optimization-guide.md)** — Built-in efficiency patterns

### Architecture & Design

- **[Routing Guide](03-mcp-routing-guide.md)** — How routing decisions are made
- **[Observability Guide](05-observability-guide.md)** — Monitoring and telemetry
- **[Repository Intake](06-repo-intake-guide.md)** — Onboard and index repositories

### Advanced Topics

- **[Optimization Deep Dive](07-optimization-guide.md)** — Fine-tune behavior and performance
- **[Azure RAG Integration](08-azure-rag-builder-integration.md)** — Enterprise document search
- **[RAG Production Guide](09-rag_mcp_production_guide_PRO.md)** — Production RAG deployments

---

## 🏗️ Architecture

The engine consists of:

- **Orchestrator** — Routes intents to the right agent and knowledge source
- **Agents** — Specialized operators (backend, frontend, DBA, etc.)
- **Skills** — Reusable capabilities (token-saver, caveman-mode, etc.)
- **Observability** — Routing decisions, metrics, and learning loops
- **Specs** — Declarative requirements and validation

See [ARCHITECTURE.md](../ARCHITECTURE.md) for details.

---

## 🛠️ Key Concepts

### Spec-Driven Development

All changes are validated against specs in `specs/`. Each spec declares:
- **Objective** — What the component does
- **Validation minima** — Executable tests that must pass before merge

### Memory-First Routing

Before executing any task:
1. Check **user memory** (preferences, patterns)
2. Check **session memory** (task context)
3. Check **repo memory** (codebase facts)

Then execute with the selected agent/engine.

### Token Optimization

- **Token Saver** — Compact responses, reduce artifacts
- **Caveman Mode** — Direct, actionable output
- **Evidence-First** — Grounding over verbosity

---

## 📊 Observability

Track routing decisions, metrics, and learning feedback:

- **Routing Log** — Every routing event with agent, engine, and grounding
- **Learning Loop** — Feedback from outcomes feeds back into routing
- **Evaluations** — Continuous validation against specs

---

## 🔐 Security & Compliance

- **Security Policy** — No secrets in logs, snapshots, or indices
- **RBAC Policies** — Least-privilege role assignments
- **Audit Trail** — Full traceability of decisions and actions

See `policies/` for details.

---

## 💡 Common Tasks

### Run Spec Validation

```bash
# All specs
py -3 .\scripts\intake\run-routing-evals.py

# Individual specs
py -3 .\scripts\intake\validate-security.py
py -3 .\scripts\intake\validate-database-routing.py
py -3 .\scripts\intake\validate-rag-routing.py
```

### Index a Repository

```bash
py -3 .\scripts\intake\repo-intake.py --repo https://github.com/user/repo
```

### View Routing Decisions

```bash
# Real-time log
Get-Content .\observability\logs\routing-decisions.jsonl -Tail 10
```

---

## 📝 Contributing

1. Read [AGENTS.md](../AGENTS.md) to understand routing
2. Check [CLAUDE.md](../CLAUDE.md) for GitNexus and CodeGraph usage
3. Ensure changes pass all specs before PR
4. Use the [PR template](.github/pull_request_template.md)

---

## 📄 License

MIT License — See [LICENSE](../LICENSE)

---

## 🤝 Support

- **Issues**: Use [GitHub Issues](.github/ISSUE_TEMPLATE/) with the appropriate template
- **Discussions**: Check existing docs first
- **Code**: See examples in `examples/use-cases/`

---

**Last updated**: {{ site.time | date: '%Y-%m-%d' }}
