## Release Process

Releases are automated based on semver selections in merged PRs:

1. Go to **Actions** → **Release** workflow
2. Click "**Run workflow**" → "**Run workflow**"
3. The workflow will automatically:
   - Analyze all merged PRs since the last release
   - Determine the version bump based on the highest semver selection (MAJOR > MINOR > PATCH)
   - Calculate the next version number using `npm version`
   - Update package.json version
   - Update CHANGELOG.md with the release date
   - Commit the changes
   - Create a git tag with the calculated version
   - **Create a draft release** with auto-generated release notes
4. Go to the **Releases** page to review the draft release
5. Edit and curate the release notes as needed
6. Click "**Publish release**" when ready

**Note**: The release is created as a draft with all file updates already committed, allowing manual curation of release notes before publishing.
