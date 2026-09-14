# Development and release workflow

- Work on `dev`. Do not edit or push directly to `main`.
- Run `npm test` and `npm run build` before pushing changes.
- Push changes to `dev` and create or update a pull request from `dev` to `main`.
- Keep the pull request open for the user to review and merge unless the user explicitly asks you to merge it.
- `Check changes` validates dev pushes and pull requests to main. It must not deploy the live site.
- `Deploy GitHub Pages` deploys only pushes to main, including merged pull requests.
- Keep the long-lived dev branch after merging. Prefer merge commits for dev-to-main PRs, then merge origin/main into dev before starting the next change. Do not force-push either branch.
- Production URL: https://uwoplanner.com/
