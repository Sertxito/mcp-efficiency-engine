# 📋 Portfolio Standardization — Execution Plan

**Status:** Ready to Execute  
**Date:** 2026-07-04  
**Owner:** Sertxito

---

## 🎯 Objectives

1. ✅ **Audit baseline:** Identified 7 boost_* repos + personal profile
2. ✅ **Create templates:** Standardized README, LICENSE, CODEOWNERS, CI workflows
3. ⏳ **Apply to repos:** Use gh CLI + PowerShell automation
4. ⏳ **Verify:** Manual check or validation script

---

## 📦 What Was Created

### Templates (in `templates/`)

| File | Purpose | Used For |
|------|---------|----------|
| `BOOST_README_TEMPLATE.md` | Standard README structure | All boost_* repos |
| `LICENSE_MIT_TEMPLATE.txt` | MIT License | All public repos |
| `CODEOWNERS_TEMPLATE.txt` | Code ownership rules | All repos |
| `ci.yml.template` | GitHub Actions CI workflow | All public repos |
| `PERSONAL_README_TEMPLATE.md` | Portfolio profile README | Sertxito/Sertxito repo |

### Automation Scripts (in `scripts/github/`)

| Script | Purpose | Trigger |
|--------|---------|---------|
| `apply-boost-templates.ps1` | Bulk apply templates to repos | Manual or workflow |
| `sync-repo.ps1` | Sync changes between repos | `auto-sync.yml` |
| `create-devlog.ps1` | Generate devlog from commits | `auto-devlog.yml` |
| `manage-issues.ps1` | Automated issue management | `auto-manage-issues.yml` |

---

## 🚀 Execution Phases

### Phase 1: Personal Profile Update (Immediate)

**Target:** Sertxito/Sertxito repo

```bash
# Manual steps:
1. Clone: gh repo clone Sertxito/Sertxito
2. Copy content from templates/PERSONAL_README_TEMPLATE.md → README.md
3. Customize links and descriptions
4. Commit & push: git add README.md && git commit -m "docs: update portfolio profile" && git push
```

**Alternative (automated):**
```bash
# Use GitHub CLI to upload directly
gh api repos/Sertxito/Sertxito/contents/README.md \
  --input templates/PERSONAL_README_TEMPLATE.md \
  -H "Accept: application/vnd.github.v3+json"
```

### Phase 2: Public Boost Repos (This Week)

**Targets:** 
- boost_RAG-Azure
- boost_backend
- boost_azure-iot-edge

**Automated approach:**

```bash
# Run script with DRY-RUN first
pwsh scripts/github/apply-boost-templates.ps1 `
  -RepoNames @("boost_RAG-Azure", "boost_backend", "boost_azure-iot-edge") `
  -DryRun

# Review output, then apply for real
pwsh scripts/github/apply-boost-templates.ps1 `
  -RepoNames @("boost_RAG-Azure", "boost_backend", "boost_azure-iot-edge")
```

**Manual approach (per repo):**

For each repo:
```bash
# 1. Clone
gh repo clone Sertxito/{REPO}

# 2. Create .github if needed
mkdir -p .github/workflows
mkdir -p .github/ISSUE_TEMPLATE

# 3. Copy templates
cp ../templates/BOOST_README_TEMPLATE.md README.md
cp ../templates/LICENSE_MIT_TEMPLATE.txt LICENSE
cp ../templates/CODEOWNERS_TEMPLATE.txt .github/CODEOWNERS
cp ../templates/ci.yml.template .github/workflows/ci.yml

# 4. Customize README (replace {PLACEHOLDERS})
# 5. Commit & create PR
git add .
git commit -m "refactor: apply standardized templates"
git push origin feat/standards-$(date +%s)

# 6. Create PR
gh pr create --base main --fill
```

### Phase 3: Private Boost Repos (Next Week)

**Targets:**
- boost_sertxIA
- boost_frontend
- boost_architect-forensics-expert
- boost_design-UX-with-Intent

**Same as Phase 2** — only difference is they won't be visible publicly.

### Phase 4: Verification & Monitoring (Ongoing)

**Checklist:**

```bash
# For each repo, verify:
✅ README.md exists and has all sections
✅ LICENSE file (MIT)
✅ .github/CODEOWNERS defined
✅ .github/workflows/ci.yml present
✅ GitHub Actions badge in README
✅ MIT License badge in README
✅ Link back to mcp-efficiency-engine

# Run compliance check
for repo in boost_RAG-Azure boost_backend boost_azure-iot-edge; do
  echo "Checking $repo..."
  gh repo view Sertxito/$repo --json name,description
done
```

---

## 📊 Alignment Matrix

**Tier 1: mcp-efficiency-engine (Gold Standard)**
- ✅ README: Complete with all sections
- ✅ LICENSE: MIT + badge
- ✅ .github/: 6 workflows, 11 agents, CODEOWNERS, templates
- ✅ CI/CD: Full validation pipeline
- ✅ GitHub Pages: ✅ LIVE

**Tier 2: Public Boost Repos (Target State)**
- ⏳ README: Standardized template applied
- ⏳ LICENSE: MIT + badge
- ⏳ .github/: CODEOWNERS + CI workflow
- ⏳ CI/CD: Basic validation + linting
- ⏳ GitHub Actions badge

**Tier 3: Private Boost Repos (Target State)**
- ⏳ README: Same as Tier 2
- ⏳ LICENSE: MIT (internal use)
- ⏳ .github/: Same as Tier 2
- ⏳ CI/CD: Same as Tier 2
- 🔒 Private visibility

**Tier 4: Personal Profile (Sertxito/Sertxito)**
- ⏳ README: Custom profile with portfolio links
- ✅ Links to all main projects
- ✅ Tech stack and mission statement

---

## 🔄 Automation Opportunities

### Ongoing Sync (Already Configured)

**`.github/workflows/auto-sync.yml`** — Keeps mcp-efficiency-engine ↔ boost_sertxIA synchronized
- Runs on: Push to main + manual trigger
- Current: DryRun mode (safe preview)

### Potential Future Automation

```bash
# Sync templates to all repos automatically
- Trigger: When templates/* change in mcp-efficiency-engine
- Action: Create PRs to all boost_* repos with updated templates
- Tool: apply-boost-templates.ps1 scheduled

# Update CI status across portfolio
- Trigger: Monday 9 AM
- Action: Verify all repos have passing CI
- Tool: manage-issues.ps1 report mode

# Aggregate metrics
- Trigger: Weekly
- Action: Generate portfolio health report
- Output: commit count, PR review time, CI status
```

---

## ✅ Success Criteria

**Phase 1 Complete When:**
- [ ] Sertxito/Sertxito has custom README
- [ ] Portfolio links are visible
- [ ] GitHub profile looks professional

**Phase 2 Complete When:**
- [ ] All 3 public boost_* repos have README + LICENSE + workflows
- [ ] CI workflows passing on all repos
- [ ] GitHub Actions badges showing in README

**Phase 3 Complete When:**
- [ ] All 4 private boost_* repos have same structure as public ones
- [ ] Team can easily navigate across all repos

**Overall Complete When:**
- [ ] Unified portfolio visible across all repos
- [ ] Standardized branching, PR, and CI patterns
- [ ] Audit report shows 100% compliance

---

## 🛠️ Tools Needed

- ✅ `gh` CLI (GitHub Command Line)
- ✅ `git` (version control)
- ✅ PowerShell 7 (scripting)
- ✅ `jq` or PowerShell JSON parsing (optional, for advanced queries)

---

## 📝 Next Steps

### Immediate (Today)
1. Review this execution plan
2. Run `apply-boost-templates.ps1` with `-DryRun` flag
3. Verify output looks correct

### This Week
1. Execute Phase 1 (personal README)
2. Execute Phase 2 (public boost_* repos)
3. Verify all repos have valid CI/CD

### Next Week
1. Execute Phase 3 (private boost_* repos)
2. Run compliance audit
3. Document portfolio in mcp-efficiency-engine main README

### Ongoing
1. Monitor CI status across repos
2. Update templates as patterns evolve
3. Sync improvements back to all repos

---

## 📞 Support & Questions

**Template Issues?**
- Edit templates in `mcp-efficiency-engine/templates/`
- Re-run `apply-boost-templates.ps1` to apply updates

**Automation Errors?**
- Check GitHub API token: `gh auth status`
- Review script logs in terminal
- Check individual repo permissions

**Need Manual Customization?**
- Use templates as starting point
- Customize per-repo requirements
- Document exceptions in repo CONTRIBUTING.md

---

**Created:** 2026-07-04  
**Status:** ⏳ Ready for execution  
**Last Updated:** 2026-07-04
