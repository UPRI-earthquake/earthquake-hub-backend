#!/usr/bin/env bash
# Shared preflight for manual digest-only staging and versioned release promotions.
set -euo pipefail

: "${IMAGE:?}"
: "${SOURCE_SHA:?}"
: "${EXPECTED_DIGEST:?}"
: "${PROMOTION_MODE:?}"
: "${GITHUB_REPOSITORY:?}"
: "${GH_TOKEN:?}"

[[ "${SOURCE_SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo 'Source commit must be a full lowercase 40-character SHA'; exit 1; }
[[ "${EXPECTED_DIGEST}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Expected digest must be sha256 followed by 64 lowercase hexadecimal characters'; exit 1; }

case "${PROMOTION_MODE}" in
  staging)
    target_branch=staging
    confirmation="PROMOTE-STAGING"
    ;;
  release)
    target_branch=main
    confirmation="APPROVE-VERSION"
    [[ "${RELEASE_VERSION:-}" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
      echo 'Use a release version such as v1.2.3'; exit 1;
    }
    ;;
  *) echo "Unsupported promotion mode: ${PROMOTION_MODE}"; exit 1 ;;
esac

if [[ "${DRY_RUN:-true}" == 'false' && "${CONFIRMATION:-}" != "$confirmation" ]]; then
  echo "Live promotion requires confirmation: $confirmation"
  exit 1
fi

# Use only release-control code from the exact commit selected at workflow dispatch.
# A protected branch must still point to this commit; restart if it advanced.
expected_ref="refs/heads/${target_branch}"
[[ "${GITHUB_REF}" == "$expected_ref" ]] || {
  echo "Run ${PROMOTION_MODE} promotion from ${target_branch}, not ${GITHUB_REF}"
  exit 1
}
[[ "${GITHUB_REF_NAME:-}" == "$target_branch" ]] || { echo 'Unexpected workflow ref name'; exit 1; }
[[ -n "${GITHUB_SHA:-}" ]] || { echo 'Workflow dispatch SHA is required'; exit 1; }
checked_out_sha="$(git rev-parse HEAD)"
[[ "$checked_out_sha" == "$GITHUB_SHA" ]] || {
  echo "Checked-out workflow code does not match the dispatched commit."
  exit 1
}
current_target_sha="$(git rev-parse "refs/remotes/origin/$target_branch")"
[[ "$current_target_sha" == "$GITHUB_SHA" ]] || {
  echo "The protected ${target_branch} branch advanced after dispatch; rerun from its current tip."
  exit 1
}
git cat-file -e "${SOURCE_SHA}^{commit}" || { echo 'Selected source commit not available'; exit 1; }
git merge-base --is-ancestor "$SOURCE_SHA" "refs/remotes/origin/$target_branch" || {
  echo "Source commit is not in the promoted $target_branch history."
  exit 1
}

# The original artifact must come from successful dev push CI.
ci_count="$(gh api -X GET "repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs" \
  -f head_sha="$SOURCE_SHA" -f event=push -f status=success -f per_page=10 \
  --jq '.total_count')"
[[ "$ci_count" =~ ^[0-9]+$ && "$ci_count" -ge 1 ]] || {
  echo "No successful dev push CI run for $SOURCE_SHA"
  exit 1
}

source_digest="$(docker buildx imagetools inspect "${IMAGE}:sha-${SOURCE_SHA}" --format '{{.Manifest.Digest}}')"
[[ "$source_digest" == "$EXPECTED_DIGEST" ]] || {
  echo "Digest mismatch: source tag resolves to $source_digest, expected $EXPECTED_DIGEST"
  exit 1
}

if [[ "$PROMOTION_MODE" == release ]]; then
  staging_digest="$(docker buildx imagetools inspect "${IMAGE}:staging" --format '{{.Manifest.Digest}}')"
  [[ "$staging_digest" == "$EXPECTED_DIGEST" ]] || {
    echo "The staging candidate changed: expected $EXPECTED_DIGEST, actual $staging_digest"
    exit 1
  }
  existing_git_tag="$(git ls-remote --tags origin "refs/tags/${RELEASE_VERSION}")"
  [[ -z "$existing_git_tag" ]] || { echo 'Git release tag already exists'; exit 1; }
  if docker buildx imagetools inspect "${IMAGE}:${RELEASE_VERSION}" >/dev/null 2>&1; then
    echo 'GHCR release tag already exists: refusing to overwrite'
    exit 1
  fi
  if gh release view "$RELEASE_VERSION" >/dev/null 2>&1; then
    echo 'GitHub Release already exists: refusing to overwrite'
    exit 1
  fi
fi

echo "Verified: $IMAGE@$EXPECTED_DIGEST"
echo "Source: $SOURCE_SHA; promoted branch: $target_branch; mode: $PROMOTION_MODE"
if [[ "${DRY_RUN:-true}" == true ]]; then
  echo "DRY RUN: no tags or GitHub Releases will be created."
fi
{
  echo "### Promotion preflight"
  printf -- '- Mode: `%s`; dry-run: `%s`\n' "$PROMOTION_MODE" "${DRY_RUN:-true}"
  printf -- '- Source commit: `%s` (passed dev push CI)\n' "$SOURCE_SHA"
  printf -- '- Verified artifact: `%s@%s`\n' "$IMAGE" "$EXPECTED_DIGEST"
  printf -- '- Verified branch: `%s`\n' "$target_branch"
} >> "$GITHUB_STEP_SUMMARY"
