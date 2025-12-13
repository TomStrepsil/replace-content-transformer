# Branch Protection Configuration

To complete the setup of this repository, the `main` branch needs to be protected with the following settings:

## Steps to Configure Branch Protection

1. Go to the repository settings: `https://github.com/TomStrepsil/replace-content-transfomer/settings`
2. Navigate to **Branches** in the left sidebar
3. Click **Add branch protection rule**
4. Configure the following settings:

### Branch name pattern
```
main
```

### Protection settings

#### Protect matching branches
- [x] **Require a pull request before merging**
  - [x] Require approvals: 1 (or as desired)
  - [x] Dismiss stale pull request approvals when new commits are pushed
  - [ ] Require review from Code Owners (optional, if you have a CODEOWNERS file)

- [x] **Require status checks to pass before merging**
  - [x] Require branches to be up to date before merging
  - Add required status checks:
    - `check` (from the PR Checks workflow)

- [x] **Require conversation resolution before merging**

- [x] **Do not allow bypassing the above settings**

- [ ] **Allow force pushes** (keep unchecked)

- [ ] **Allow deletions** (keep unchecked)

### Additional Recommendations

1. **Enable required status checks**: After the first PR runs, the `check` job from `.github/workflows/pr-check.yml` will appear in the list of available status checks. Add it as required.

2. **Repository Settings**: Consider also enabling:
   - Automatically delete head branches
   - Allow merge commits (or choose your preferred merge strategy)

3. **Team Access**: Configure appropriate access levels for collaborators

## Verification

After setting up branch protection:
1. Try to push directly to `main` - it should be blocked
2. Create a PR to `main` - it should require the checks to pass
3. Verify the CHANGELOG check works by creating a PR without updating CHANGELOG.md

## Notes

- The release workflow requires `write` permissions for contents, which is already configured in the workflow file
- The PR template includes semver checkboxes to help with versioning decisions
- All PRs must include an entry in the `[Unreleased]` section of CHANGELOG.md
