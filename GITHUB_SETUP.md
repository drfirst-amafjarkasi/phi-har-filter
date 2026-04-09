# GitHub Setup Guide for `har-filter`

This guide explains how to create and push the `har-filter` repository to GitHub.

## Quick Start

### 1. Create Repository on GitHub

Create a new **public** repository on GitHub:

- **Repository Name:** `har-filter`
- **Description:** Filter HAR files with HIPAA privacy redaction
- **Visibility:** Public (for team collaboration)
- **Initialize with README:** NO (we have our own)
- **Add .gitignore:** NO (we have our own)
- **Add LICENSE:** Choose MIT (recommended for open-source CLI tools)

**URL:** `https://github.com/YOUR_ORG/har-filter`

### 2. Update Package.json

Edit `package.json` to use your actual repository URL:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/YOUR_ORG/har-filter.git"
},
"homepage": "https://github.com/YOUR_ORG/har-filter#readme",
"bugs": {
  "url": "https://github.com/YOUR_ORG/har-filter/issues"
}
```

Then commit this change:
```bash
git add package.json
git commit -m "update: use actual GitHub repository URL"
```

### 3. Push to GitHub

```bash
# Add remote (replace YOUR_ORG with actual organization)
git remote add origin https://github.com/YOUR_ORG/har-filter.git

# Push to GitHub
git branch -M main
git push -u origin main
```

### 4. Configure GitHub Repository Settings

Go to **Settings** → **General** on GitHub and update:

#### About Section
- **Short Description:** 
  ```
  Filter HAR files with HIPAA privacy redaction
  ```
- **Website:** (optional, your docs site)

#### Topics/Tags
Add these topics for discoverability:
```
har, http-archive, privacy, redaction, hipaa, drfirst, cli, node, 
patient-data, phi, filtering, network-analysis, security
```

Copy-paste from `.github/GITHUB_SETTINGS.md` for complete list.

#### Visibility & Access
- **Repository visibility:** Public
- **Branch and tag protection:** (optional, set up later if needed)

### 5. Enable GitHub Features

#### Actions (CI/CD)
- Go to **Settings** → **Actions** → **General**
- Enable Actions for this repository
- Workflow `.github/workflows/test.yml` will automatically run on PR/push

#### Issues
- Enable **Issue templates** (already configured)
- Set issue templates at **Settings** → **Features** → **Issues**

#### Discussions
- (Optional) Enable for Q&A: **Settings** → **Features** → **Discussions**

### 6. Add Collaborators (if team-based)

- Go to **Settings** → **Collaborators**
- Invite team members

## Verification

After pushing, verify:

```bash
# Check remote is set correctly
git remote -v

# Should show:
# origin  https://github.com/YOUR_ORG/har-filter.git (fetch)
# origin  https://github.com/YOUR_ORG/har-filter.git (push)
```

Visit `https://github.com/YOUR_ORG/har-filter` and confirm:
- ✓ README.md displays correctly
- ✓ 2 commits visible in history
- ✓ All files present (bin/, src/, test/, .github/)
- ✓ Topics show under repository name
- ✓ Description appears in "About" section

## GitHub Pages / Docs (Optional)

To add documentation site:

1. Create `docs/` directory
2. Configure GitHub Pages: **Settings** → **Pages**
3. Select **Source:** Deploy from a branch
4. Choose **Branch:** main, **Folder:** /docs

## Protecting Main Branch (Recommended)

For production-ready projects, add branch protection:

1. Go to **Settings** → **Branches**
2. Add rule for `main` branch
3. Require:
   - ✓ Pull request reviews before merging
   - ✓ Status checks to pass (including test.yml)
   - ✓ Conversation resolution

## Troubleshooting

### Push fails with "fatal: repository not found"

- Verify URL is correct: `git remote -v`
- Check you have permission to the organization
- If using SSH, ensure SSH keys are added to GitHub

### Actions not running

- Check **Actions** tab → **Workflows**
- Verify `test.yml` is present in `.github/workflows/`
- May take 1-2 minutes to show up

### README not displaying

- Ensure README.md exists in repository root
- Verify markdown syntax (try viewing raw file)

## Next Steps

1. **Update README.md** with any team-specific information
2. **Set up project board** (optional): **Projects** → **New project**
3. **Create first issue** to track enhancement ideas
4. **Invite collaborators** for code review
5. **Configure branch protection** for main branch

## Additional Resources

- [GitHub repository docs](https://docs.github.com/en/repositories)
- [GitHub Actions docs](https://docs.github.com/en/actions)
- [Contributing guide](CONTRIBUTING.md)
- [GitHub settings reference](.github/GITHUB_SETTINGS.md)

---

**Repository slug:** `har-filter`  
**Full project name:** HAR Filter with HIPAA-Oriented Privacy Redaction  
**Organization:** YOUR_ORG  
**Status:** Ready for team collaboration
